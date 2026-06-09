import type { FastifyInstance } from 'fastify'
import { requireSuperuser } from '../middleware/auth.js'
import { proxyRequest } from '../services/proxy.js'

/**
 * Cross-household admin views (households, nodes) that the regular
 * user-scoped routes don't expose. Backed by jarvis-auth's
 * /superuser/* endpoints; the caller's superuser JWT is forwarded.
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSuperuser)

  app.get('/households', async (request, reply) => {
    const result = await proxyRequest({
      method: 'GET',
      url: `${app.config.authUrl}/superuser/households`,
      headers: { Authorization: request.headers.authorization! },
      timeout: 10_000,
    })
    reply.code(result.status).send(result.data)
  })

  app.get('/nodes', async (request, reply) => {
    const result = await proxyRequest({
      method: 'GET',
      url: `${app.config.authUrl}/superuser/nodes`,
      headers: { Authorization: request.headers.authorization! },
      timeout: 10_000,
    })
    reply.code(result.status).send(result.data)
  })
}
