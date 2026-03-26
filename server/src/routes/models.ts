import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { FastifyInstance } from 'fastify'
import { requireSuperuser } from '../middleware/auth.js'

interface ModelInfo {
  name: string
  size: number
  sizeFormatted: string
}

interface DownloadBody {
  repo: string
  filename?: string
  token?: string
}

const SUGGESTED_MODELS = [
  {
    repo: 'Qwen/Qwen3-14B-GGUF',
    filename: 'Qwen3-14B-Q6_K.gguf',
    label: 'Qwen 3 14B (Q6_K)',
    description: 'High-quality 14B model, good balance of speed and quality',
    sizeEstimate: '11.5 GB',
    promptProvider: 'Qwen3Medium',
  },
  {
    repo: 'Qwen/Qwen3-14B-GGUF',
    filename: 'Qwen3-14B-Q4_K_M.gguf',
    label: 'Qwen 3 14B (Q4_K_M)',
    description: 'Smaller quantization, faster inference, slightly lower quality',
    sizeEstimate: '8.7 GB',
    promptProvider: 'Qwen3Medium',
  },
  {
    repo: 'Qwen/Qwen3-32B-GGUF',
    filename: 'Qwen3-32B-Q4_K_M.gguf',
    label: 'Qwen 3 32B (Q4_K_M)',
    description: 'Larger model, better reasoning, needs ~20 GB VRAM',
    sizeEstimate: '19.9 GB',
    promptProvider: 'Qwen3Large',
  },
  {
    repo: 'Qwen/Qwen2.5-7B-Instruct-GGUF',
    filename: 'qwen2.5-7b-instruct-q4_k_m.gguf',
    label: 'Qwen 2.5 7B Instruct (Q4_K_M)',
    description: 'Fast 7B model, good for constrained hardware',
    sizeEstimate: '4.7 GB',
    promptProvider: 'Qwen25MediumUntrained',
  },
  {
    repo: 'NousResearch/Hermes-3-Llama-3.1-8B-GGUF',
    filename: 'Hermes-3-Llama-3.1-8B.Q4_K_M.gguf',
    label: 'Hermes 3 Llama 3.1 8B (Q4_K_M)',
    description: 'Versatile 8B model with strong tool-calling support',
    sizeEstimate: '4.9 GB',
    promptProvider: 'Hermes3Llama31',
  },
]

/** Search paths for the .models directory (local fallback) */
function findLocalModelsDir(): string | null {
  // Explicit env var takes priority (set in docker-compose for dev)
  const envDir = process.env.MODELS_DIR
  if (envDir && existsSync(envDir)) return envDir

  const candidates = [
    join(homedir(), 'jarvis', 'jarvis-llm-proxy-api', '.models'),
    join(homedir(), '.jarvis', 'compose', '.models'),
    join(homedir(), '.jarvis', '.models'),
  ]
  for (const dir of candidates) {
    if (existsSync(dir)) return dir
  }
  return null
}

export async function modelsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSuperuser)

  /** List installed models in the .models directory */
  app.get('/installed', async (_request, reply) => {
    // Try Docker first
    const container = await findLlmContainer(app)
    if (container) {
      try {
        const output = await app.docker!.execInContainer(container.id, [
          'python', '-c',
          'import os, json; models = []; d = "/app/.models"; [models.append({"name": f, "size": os.path.getsize(os.path.join(d, f))}) for f in os.listdir(d) if f.endswith((".gguf", ".bin")) and os.path.isfile(os.path.join(d, f))]; print(json.dumps(models))',
        ])
        const raw = extractJson(output)
        const models: ModelInfo[] = (JSON.parse(raw) as { name: string; size: number }[]).map((m) => ({
          ...m,
          sizeFormatted: formatBytes(m.size),
        }))
        return reply.send({ models })
      } catch (err) {
        console.error('[models] Docker list failed, trying local:', err)
      }
    }

    // Local filesystem fallback
    const modelsDir = findLocalModelsDir()
    if (!modelsDir) {
      return reply.send({ models: [] })
    }

    try {
      const files = readdirSync(modelsDir)
      const models: ModelInfo[] = files
        .filter((f) => f.endsWith('.gguf') || f.endsWith('.bin'))
        .map((f) => {
          const size = statSync(join(modelsDir, f)).size
          return { name: f, size, sizeFormatted: formatBytes(size) }
        })
      return reply.send({ models })
    } catch (err) {
      console.error('[models] Local list failed:', err)
      return reply.send({ models: [] })
    }
  })

  /** Return suggested models with prompt provider info */
  app.get('/suggested', async (_request, reply) => {
    return reply.send({ models: SUGGESTED_MODELS })
  })

  /** Download a model from HuggingFace */
  app.post<{ Body: DownloadBody }>('/download', async (request, reply) => {
    const { repo, filename, token } = request.body as DownloadBody

    if (!repo) {
      return reply.code(400).send({ error: 'repo is required' })
    }

    const REPO_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/
    const FILENAME_PATTERN = /^[a-zA-Z0-9_.-]+$/

    if (!REPO_PATTERN.test(repo)) {
      return reply.code(400).send({ error: 'Invalid repo format. Expected: owner/repo-name' })
    }
    if (filename && !FILENAME_PATTERN.test(filename)) {
      return reply.code(400).send({ error: 'Invalid filename format' })
    }

    // Try Docker first
    const container = await findLlmContainer(app)
    if (container) {
      const env = token ? [`HUGGINGFACE_HUB_TOKEN=${token}`] : []
      const cmd = filename
        ? [
            'python', '-c',
            'import sys, os; from huggingface_hub import hf_hub_download; print(hf_hub_download(repo_id=sys.argv[1], filename=sys.argv[2], local_dir="/app/.models", token=os.environ.get("HUGGINGFACE_HUB_TOKEN") or None))',
            repo,
            filename,
          ]
        : [
            'python', '-c',
            'import sys, os; from huggingface_hub import snapshot_download; print(snapshot_download(repo_id=sys.argv[1], local_dir=f"/app/.models/{sys.argv[1].split(\'/\')[-1]}", token=os.environ.get("HUGGINGFACE_HUB_TOKEN") or None))',
            repo,
          ]

      try {
        const output = await app.docker!.execInContainer(container.id, cmd, env)
        return reply.send({ success: true, output: output.trim(), message: 'Download complete' })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[models] Docker download failed, trying local:', msg)
      }
    }

    // Local fallback — run python subprocess on host
    const modelsDir = findLocalModelsDir()
    if (!modelsDir) {
      return reply.code(503).send({
        error: 'No LLM proxy container found and no local .models directory. Start the LLM proxy or create the directory.',
      })
    }

    try {
      const output = await runLocalPython(modelsDir, repo, filename, token)
      return reply.send({ success: true, output: output.trim(), message: 'Download complete' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[models] Local download failed:', msg)
      return reply.code(500).send({ error: `Download failed: ${msg}` })
    }
  })

  /** Delete a model file */
  app.delete<{ Params: { name: string } }>('/:name', async (request, reply) => {
    const { name } = request.params
    const FILENAME_PATTERN = /^[a-zA-Z0-9_.-]+$/

    if (!FILENAME_PATTERN.test(name)) {
      return reply.code(400).send({ error: 'Invalid filename' })
    }

    // Try Docker first
    const container = await findLlmContainer(app)
    if (container) {
      try {
        await app.docker!.execInContainer(container.id, [
          'python', '-c',
          'import sys, os; p = f"/app/.models/{sys.argv[1]}"; os.remove(p) if os.path.isfile(p) else None; print("ok")',
          name,
        ])
        return reply.send({ success: true })
      } catch (err) {
        console.error('[models] Docker delete failed, trying local:', err)
      }
    }

    // Local fallback
    const modelsDir = findLocalModelsDir()
    if (!modelsDir) {
      return reply.code(503).send({ error: 'No models directory found' })
    }

    const filePath = join(modelsDir, name)
    if (!existsSync(filePath)) {
      return reply.code(404).send({ error: 'Model not found' })
    }

    try {
      unlinkSync(filePath)
      return reply.send({ success: true })
    } catch (err) {
      console.error('[models] Local delete failed:', err)
      return reply.code(500).send({ error: 'Failed to delete model' })
    }
  })
}

async function findLlmContainer(app: FastifyInstance) {
  if (!app.docker) return null
  try {
    const containers = await app.docker.listJarvisContainers()
    return containers.find(
      (c) =>
        (c.name.includes('llm-proxy') || c.name.includes('llm_proxy')) &&
        c.name.includes('api') &&
        c.state === 'running'
    ) ?? containers.find(
      (c) =>
        (c.name.includes('llm-proxy') || c.name.includes('llm_proxy')) &&
        c.state === 'running'
    ) ?? null
  } catch {
    return null
  }
}

function runLocalPython(
  modelsDir: string,
  repo: string,
  filename: string | undefined,
  token: string | undefined,
): Promise<string> {
  const pyCode = filename
    ? `import sys, os; from huggingface_hub import hf_hub_download; print(hf_hub_download(repo_id=sys.argv[1], filename=sys.argv[2], local_dir=sys.argv[3], token=os.environ.get("HUGGINGFACE_HUB_TOKEN") or None))`
    : `import sys, os; from huggingface_hub import snapshot_download; print(snapshot_download(repo_id=sys.argv[1], local_dir=sys.argv[3] + "/" + sys.argv[1].split("/")[-1], token=os.environ.get("HUGGINGFACE_HUB_TOKEN") or None))`

  const args = filename
    ? ['python3', '-c', pyCode, repo, filename, modelsDir]
    : ['python3', '-c', pyCode, repo, '', modelsDir]

  const env = { ...process.env }
  if (token) env.HUGGINGFACE_HUB_TOKEN = token

  return new Promise((resolve, reject) => {
    execFile(args[0]!, args.slice(1), { env, timeout: 600_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message))
      } else {
        resolve(stdout)
      }
    })
  })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** Extract the first JSON array or object from Docker exec output (may have header bytes) */
function extractJson(raw: string): string {
  const start = raw.indexOf('[')
  if (start === -1) return '[]'
  return raw.slice(start)
}
