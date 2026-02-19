import type { FastifyInstance } from 'fastify'
import { requireSuperuser } from '../middleware/auth.js'
import { proxyRequest } from '../services/proxy.js'

interface LlmStatusResponse {
  configured: boolean
  model?: string
  backend?: string
}

interface ConfigureBody {
  settings: Record<string, unknown>
}

interface DownloadBody {
  repo: string
  filename?: string
  token?: string
}

export async function llmSetupRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSuperuser)

  /**
   * Check whether the LLM model has been configured.
   * Returns { configured: false } if using default or empty model name.
   */
  app.get('/status', async (request, reply) => {
    const llmUrl = app.config.llmProxyUrl

    if (!llmUrl) {
      return reply.send({ configured: false })
    }

    try {
      const healthResult = await proxyRequest({
        method: 'GET',
        url: `${llmUrl}/health`,
        timeout: 5_000,
      })

      if (healthResult.status !== 200) {
        return reply.send({ configured: false })
      }

      const health = healthResult.data as Record<string, unknown>
      const modelService = health.model_service as Record<string, unknown> | undefined

      if (modelService?.status === 'ok' && modelService?.backend_type) {
        return reply.send({
          configured: true,
          model: String(modelService.model_name ?? ''),
          backend: String(modelService.backend_type ?? ''),
        } satisfies LlmStatusResponse)
      }

      // Try reading the setting directly
      const settingResult = await proxyRequest({
        method: 'GET',
        url: `${llmUrl}/settings/model.main.name`,
        headers: { Authorization: request.headers.authorization! },
        timeout: 5_000,
      })

      if (settingResult.status === 200) {
        const setting = settingResult.data as { value?: string }
        const modelName = setting.value ?? ''
        const isDefault = !modelName || modelName.includes('placeholder') || modelName === '.models/'
        return reply.send({
          configured: !isDefault,
          model: modelName,
          backend: '',
        } satisfies LlmStatusResponse)
      }

      return reply.send({ configured: false })
    } catch {
      return reply.send({ configured: false })
    }
  })

  /**
   * Bulk-write LLM settings and restart the model service container.
   */
  app.post<{ Body: ConfigureBody }>('/configure', async (request, reply) => {
    const llmUrl = app.config.llmProxyUrl
    const { settings } = request.body as ConfigureBody

    if (!settings || typeof settings !== 'object') {
      return reply.code(400).send({ error: 'settings object is required' })
    }

    // Only allow known LLM settings keys
    const ALLOWED_KEYS = new Set([
      'model.main.name',
      'model.main.backend',
      'model.main.chat_format',
      'model.main.context_window',
      'inference.gguf.n_gpu_layers',
      'inference.gguf.n_threads',
      'inference.vllm.quantization',
      'inference.vllm.gpu_memory_utilization',
    ])
    const invalidKeys = Object.keys(settings).filter((k) => !ALLOWED_KEYS.has(k))
    if (invalidKeys.length > 0) {
      return reply.code(400).send({ error: `Invalid settings keys: ${invalidKeys.join(', ')}` })
    }

    if (!llmUrl) {
      return reply.code(503).send({ error: 'LLM proxy URL not configured' })
    }

    const settingsResult = await proxyRequest({
      method: 'PUT',
      url: `${llmUrl}/settings/`,
      headers: { Authorization: request.headers.authorization! },
      body: { settings },
      timeout: 10_000,
    })

    if (settingsResult.status !== 200) {
      return reply.code(settingsResult.status).send(settingsResult.data)
    }

    // Restart llm-proxy containers if Docker is available
    const docker = app.docker
    if (docker) {
      try {
        const containers = await docker.listJarvisContainers()
        const llmContainers = containers.filter(
          (c) => c.name.includes('llm-proxy') || c.name.includes('llm_proxy')
        )

        for (const container of llmContainers) {
          await docker.restartContainer(container.id)
        }
      } catch (err) {
        console.warn('[llm-setup] Container restart failed:', err)
      }
    }

    return reply.send({
      success: true,
      settingsResult: settingsResult.data,
      message: 'Settings saved. LLM proxy restarting.',
    })
  })

  /**
   * Trigger model download inside the llm-proxy container.
   */
  app.post<{ Body: DownloadBody }>('/download', async (request, reply) => {
    const { repo, filename, token } = request.body as DownloadBody

    if (!repo) {
      return reply.code(400).send({ error: 'repo is required' })
    }

    // Validate inputs to prevent command injection
    const REPO_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/
    const FILENAME_PATTERN = /^[a-zA-Z0-9_.\-]+$/

    if (!REPO_PATTERN.test(repo)) {
      return reply.code(400).send({ error: 'Invalid repo format. Expected: owner/repo-name' })
    }

    if (filename && !FILENAME_PATTERN.test(filename)) {
      return reply.code(400).send({ error: 'Invalid filename format' })
    }

    const docker = app.docker
    if (!docker) {
      return reply.code(503).send({ error: 'Docker is not available' })
    }

    const containers = await docker.listJarvisContainers()
    const apiContainer = containers.find(
      (c) =>
        (c.name.includes('llm-proxy') || c.name.includes('llm_proxy')) &&
        c.name.includes('api') &&
        c.state === 'running'
    ) ?? containers.find(
      (c) =>
        (c.name.includes('llm-proxy') || c.name.includes('llm_proxy')) &&
        c.state === 'running'
    )

    if (!apiContainer) {
      return reply.code(503).send({ error: 'LLM proxy container not found or not running' })
    }

    const env = token ? [`HUGGINGFACE_HUB_TOKEN=${token}`] : []

    // Use sys.argv to pass user values safely — never interpolate into Python source
    const cmd = filename
      ? [
          'python', '-c',
          'import sys, os; from huggingface_hub import hf_hub_download; hf_hub_download(repo_id=sys.argv[1], filename=sys.argv[2], local_dir="/app/.models", token=os.environ.get("HUGGINGFACE_HUB_TOKEN") or None)',
          repo,
          filename,
        ]
      : [
          'python', '-c',
          'import sys, os; from huggingface_hub import snapshot_download; snapshot_download(repo_id=sys.argv[1], local_dir=f"/app/.models/{sys.argv[1].split(\'/\')[-1]}", token=os.environ.get("HUGGINGFACE_HUB_TOKEN") or None)',
          repo,
        ]

    try {
      const output = await docker.execInContainer(apiContainer.id, cmd, env)

      return reply.send({
        success: true,
        output,
        message: 'Download complete',
      })
    } catch (err) {
      console.error('[llm-setup] Download failed:', err)
      return reply.code(500).send({
        error: 'Download failed. Check server logs for details.',
      })
    }
  })
}
