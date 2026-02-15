import type { FastifyInstance } from 'fastify'
import { savePersistedConfig } from '../config.js'
import { resolveServiceUrls } from '../services/configService.js'
import type { Config } from '../config.js'

interface ProbeBody {
  url: string
}

interface ProbeResult {
  healthy: boolean
  error?: string
}

export async function setupRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Check whether the admin backend has been configured with service URLs.
   * Frontend uses this to decide whether to show the setup wizard.
   */
  app.get('/status', async (_request, reply) => {
    return reply.send({
      configured: !!app.config.authUrl && !!app.config.configServiceUrl,
    })
  })

  /**
   * Probe a URL's health endpoint to verify it's reachable.
   * Used by the setup wizard to validate Auth URL and Config URL.
   */
  app.post<{ Body: ProbeBody }>('/probe', async (request, reply) => {
    const { url } = request.body as ProbeBody

    if (!url || typeof url !== 'string') {
      return reply.code(400).send({ healthy: false, error: 'URL is required' })
    }

    // Validate URL format
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return reply.code(400).send({ healthy: false, error: 'Invalid URL format' })
    }

    // Only allow http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return reply.code(400).send({ healthy: false, error: 'URL must use http or https' })
    }

    // Try /health first, then /info, then root
    const paths = ['/health', '/info', '/']
    let lastError = ''

    for (const path of paths) {
      try {
        const probeUrl = `${url.replace(/\/$/, '')}${path}`
        const response = await fetch(probeUrl, {
          signal: AbortSignal.timeout(5000),
        })

        if (response.ok) {
          const result: ProbeResult = { healthy: true }
          return reply.send(result)
        }

        lastError = `HTTP ${response.status}`
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
      }
    }

    const result: ProbeResult = { healthy: false, error: lastError }
    return reply.send(result)
  })

  /**
   * Save setup configuration (Auth URL and Config URL).
   * Persists to ~/.jarvis/admin.json and updates the in-memory config.
   */
  app.post<{ Body: { authUrl: string; configUrl: string } }>(
    '/configure',
    async (request, reply) => {
      const { authUrl, configUrl } = request.body as {
        authUrl: string
        configUrl: string
      }

      if (!authUrl || !configUrl) {
        return reply
          .code(400)
          .send({ error: 'Both authUrl and configUrl are required' })
      }

      const cleanAuthUrl = authUrl.replace(/\/$/, '')
      const cleanConfigUrl = configUrl.replace(/\/$/, '')

      // Update the running config
      app.config.authUrl = cleanAuthUrl
      app.config.configServiceUrl = cleanConfigUrl

      // Re-resolve service URLs from the new config service
      const SERVICE_NAME_TO_CONFIG: Record<string, keyof Config> = {
        'jarvis-auth': 'authUrl',
        'jarvis-llm-proxy-api': 'llmProxyUrl',
        'jarvis-command-center': 'commandCenterUrl',
        auth: 'authUrl',
        'llm-proxy': 'llmProxyUrl',
        'command-center': 'commandCenterUrl',
      }

      try {
        const serviceMap = await resolveServiceUrls(cleanConfigUrl)
        for (const [serviceName, configKey] of Object.entries(
          SERVICE_NAME_TO_CONFIG,
        )) {
          const url = serviceMap.get(serviceName)
          if (url) {
            ;(app.config as Record<string, unknown>)[configKey] = url
          }
        }
      } catch {
        // Config service may not have all services registered yet
      }

      // Persist to disk so it survives server restarts
      savePersistedConfig({
        authUrl: app.config.authUrl,
        configServiceUrl: app.config.configServiceUrl,
        llmProxyUrl: app.config.llmProxyUrl,
        commandCenterUrl: app.config.commandCenterUrl,
      })

      return reply.send({ ok: true })
    },
  )
}
