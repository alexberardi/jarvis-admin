import type { FastifyInstance } from 'fastify'
import { requireSuperuser } from '../middleware/auth.js'
import { proxyRequest } from '../services/proxy.js'

export async function servicesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSuperuser)

  app.get('/registry', async (request, reply) => {
    const configUrl = app.config.configServiceUrl

    const result = await proxyRequest({
      method: 'GET',
      url: `${configUrl}/v1/services/registry`,
      headers: { Authorization: request.headers.authorization! },
      timeout: 10_000,
    })

    reply.code(result.status).send(result.data)
  })

  app.post('/register', async (request, reply) => {
    const configUrl = app.config.configServiceUrl

    const result = await proxyRequest({
      method: 'POST',
      url: `${configUrl}/v1/services/register`,
      headers: { Authorization: request.headers.authorization! },
      body: request.body,
      timeout: 30_000,
    })

    reply.code(result.status).send(result.data)
  })

  app.post('/rotate-key', async (request, reply) => {
    const configUrl = app.config.configServiceUrl

    const result = await proxyRequest({
      method: 'POST',
      url: `${configUrl}/v1/services/rotate-key`,
      headers: { Authorization: request.headers.authorization! },
      body: request.body,
      timeout: 10_000,
    })

    reply.code(result.status).send(result.data)
  })

  app.post('/probe', async (request, reply) => {
    const configUrl = app.config.configServiceUrl

    const result = await proxyRequest({
      method: 'POST',
      url: `${configUrl}/v1/services/probe`,
      headers: { Authorization: request.headers.authorization! },
      body: request.body,
      timeout: 10_000,
    })

    reply.code(result.status).send(result.data)
  })

  app.get('/suggestions', async (_request, reply) => {
    const registry = app.registry
    if (!registry) {
      reply.send({ suggestions: [] })
      return
    }

    const allServices = registry.getRegistry().services
    const suggestions = allServices.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      port: s.port,
      healthCheck: s.healthCheck,
    }))

    reply.send({ suggestions })
  })

  app.delete<{ Params: { name: string } }>('/:name', async (request, reply) => {
    const configUrl = app.config.configServiceUrl
    const { name } = request.params

    const result = await proxyRequest({
      method: 'DELETE',
      url: `${configUrl}/v1/services/${encodeURIComponent(name)}`,
      headers: { Authorization: request.headers.authorization! },
      timeout: 10_000,
    })

    reply.code(result.status).send(result.data)
  })
}
