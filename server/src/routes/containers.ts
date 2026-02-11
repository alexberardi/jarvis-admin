import type { FastifyInstance } from 'fastify'
import { requireSuperuser } from '../middleware/auth.js'

export async function containersRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSuperuser)

  app.get('/', async (_request, reply) => {
    const docker = app.docker
    if (!docker) {
      reply.code(503).send({ error: 'Docker is not available', containers: [] })
      return
    }

    const containers = await docker.listJarvisContainers()

    // Merge with registry data for display names if available
    const registry = app.registry
    const enriched = containers.map((c) => {
      const serviceName = c.name.replace(/^jarvis[-_]/, '')
      const regEntry = registry?.getServiceById(serviceName)
      return {
        ...c,
        displayName: regEntry?.name ?? c.name,
        description: regEntry?.description ?? null,
        category: regEntry?.category ?? null,
      }
    })

    reply.send({ containers: enriched })
  })

  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const docker = app.docker
    if (!docker) {
      reply.code(503).send({ error: 'Docker is not available' })
      return
    }

    const container = await docker.getContainerStatus(request.params.id)
    if (!container) {
      reply.code(404).send({ error: 'Container not found' })
      return
    }

    const stats = await docker.getContainerStats(request.params.id)
    reply.send({ container, stats })
  })

  app.post<{ Params: { id: string } }>('/:id/restart', async (request, reply) => {
    const docker = app.docker
    if (!docker) {
      reply.code(503).send({ error: 'Docker is not available' })
      return
    }

    try {
      await docker.restartContainer(request.params.id)
      reply.send({ success: true, message: 'Container restarting' })
    } catch (err) {
      reply.code(500).send({ error: `Failed to restart container: ${(err as Error).message}` })
    }
  })
}
