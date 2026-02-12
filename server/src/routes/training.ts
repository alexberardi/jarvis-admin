import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { requireSuperuser } from '../middleware/auth.js'
import { proxyRequest } from '../services/proxy.js'

export async function trainingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSuperuser)

  app.get('/status', async (request, reply) => {
    const result = await proxyRequest({
      method: 'GET',
      url: `${app.config.llmProxyUrl}/v1/pipeline/status`,
      headers: { Authorization: request.headers.authorization! },
      timeout: 10_000,
    })
    reply.code(result.status).send(result.data)
  })

  app.post('/build', async (request, reply) => {
    const result = await proxyRequest({
      method: 'POST',
      url: `${app.config.llmProxyUrl}/v1/pipeline/build`,
      headers: { Authorization: request.headers.authorization! },
      body: request.body,
      timeout: 10_000,
    })
    reply.code(result.status).send(result.data)
  })

  app.post('/cancel', async (request, reply) => {
    const result = await proxyRequest({
      method: 'POST',
      url: `${app.config.llmProxyUrl}/v1/pipeline/cancel`,
      headers: { Authorization: request.headers.authorization! },
      timeout: 10_000,
    })
    reply.code(result.status).send(result.data)
  })

  app.get('/artifacts', async (request, reply) => {
    const result = await proxyRequest({
      method: 'GET',
      url: `${app.config.llmProxyUrl}/v1/pipeline/artifacts`,
      headers: { Authorization: request.headers.authorization! },
      timeout: 15_000,
    })
    reply.code(result.status).send(result.data)
  })

  // SSE log streaming — pass through the raw stream from llm-proxy-api
  app.get('/logs', async (request: FastifyRequest, reply: FastifyReply) => {
    const llmProxyUrl = app.config.llmProxyUrl
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 600_000) // 10 min max

    request.raw.on('close', () => {
      controller.abort()
      clearTimeout(timeoutId)
    })

    try {
      const response = await fetch(`${llmProxyUrl}/v1/pipeline/logs`, {
        headers: { Authorization: request.headers.authorization! },
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        clearTimeout(timeoutId)
        reply.code(response.status).send({ error: 'Failed to connect to log stream' })
        return
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          reply.raw.write(chunk)
        }
      } catch {
        // Client disconnected or abort — expected
      } finally {
        clearTimeout(timeoutId)
        reply.raw.end()
      }
    } catch {
      clearTimeout(timeoutId)
      if (!reply.sent) {
        reply.code(502).send({ error: 'LLM proxy service unavailable' })
      }
    }
  })
}
