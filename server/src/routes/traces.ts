import type { FastifyInstance } from 'fastify'
import { requireSuperuser } from '../middleware/auth.js'
import { proxyRequest } from '../services/proxy.js'

export async function tracesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSuperuser)

  // List recent traces (proxy to command-center)
  app.get('/', async (request, reply) => {
    const qs = new URLSearchParams(request.query as Record<string, string>).toString()
    const url = `${app.config.commandCenterUrl}/api/v0/admin/traces${qs ? `?${qs}` : ''}`
    const result = await proxyRequest({
      method: 'GET',
      url,
      headers: { 'X-API-Key': app.config.commandCenterAdminKey },
      timeout: 10_000,
    })
    reply.code(result.status).send(result.data)
  })

  // Get trace detail (proxy to command-center)
  app.get<{ Params: { traceId: string } }>(
    '/:traceId',
    async (request, reply) => {
      const { traceId } = request.params
      const result = await proxyRequest({
        method: 'GET',
        url: `${app.config.commandCenterUrl}/api/v0/admin/traces/${traceId}`,
        headers: { 'X-API-Key': app.config.commandCenterAdminKey },
        timeout: 10_000,
      })
      reply.code(result.status).send(result.data)
    },
  )
}
