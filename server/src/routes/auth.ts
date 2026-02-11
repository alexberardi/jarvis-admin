import type { FastifyInstance } from 'fastify'
import { proxyRequest } from '../services/proxy.js'

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/login', async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string }
    const authUrl = app.config.authUrl

    const result = await proxyRequest({
      method: 'POST',
      url: `${authUrl}/auth/login`,
      body: { email, password },
      timeout: 10_000,
    })

    reply.code(result.status).send(result.data)
  })

  app.post('/refresh', async (request, reply) => {
    const { refresh_token } = request.body as { refresh_token: string }
    const authUrl = app.config.authUrl

    const result = await proxyRequest({
      method: 'POST',
      url: `${authUrl}/auth/refresh`,
      body: { refresh_token },
      timeout: 10_000,
    })

    reply.code(result.status).send(result.data)
  })
}
