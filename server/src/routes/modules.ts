import type { FastifyInstance } from 'fastify'
import { requireSuperuser } from '../middleware/auth.js'

export async function modulesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSuperuser)

  app.get('/', async (_request, reply) => {
    const registry = app.registry
    if (!registry) {
      reply.code(503).send({ error: 'Service registry not configured', modules: [] })
      return
    }

    const optional = registry.getOptionalServices()
    const docker = app.docker

    // Check which modules are currently running
    const containers = docker ? await docker.listJarvisContainers() : []
    const runningNames = new Set(containers.map((c) => c.name))

    const modules = optional.map((svc) => ({
      id: svc.id,
      name: svc.name,
      description: svc.description,
      port: svc.port,
      profile: svc.profile ?? svc.id,
      dependsOn: svc.dependsOn,
      enabled: runningNames.has(`jarvis-${svc.id}`) || runningNames.has(`jarvis_${svc.id}`),
    }))

    reply.send({ modules })
  })

  app.post<{ Params: { id: string } }>('/:id/enable', async (request, reply) => {
    const compose = app.compose
    const registry = app.registry
    if (!compose || !registry) {
      reply.code(503).send({ error: 'Compose or registry not available' })
      return
    }

    const service = registry.getServiceById(request.params.id)
    if (!service) {
      reply.code(404).send({ error: 'Module not found' })
      return
    }

    const profile = service.profile ?? service.id

    try {
      await compose.enableModule(profile)
      reply.send({ success: true, message: `Module ${service.name} enabled` })
    } catch (err) {
      reply.code(500).send({ error: `Failed to enable module: ${(err as Error).message}` })
    }
  })

  app.post<{ Params: { id: string } }>('/:id/disable', async (request, reply) => {
    const compose = app.compose
    const registry = app.registry
    if (!compose || !registry) {
      reply.code(503).send({ error: 'Compose or registry not available' })
      return
    }

    const service = registry.getServiceById(request.params.id)
    if (!service) {
      reply.code(404).send({ error: 'Module not found' })
      return
    }

    // Check if any enabled module depends on this one
    const dependents = registry.getDependents(service.id)
    if (dependents.length > 0) {
      const docker = app.docker
      if (docker) {
        const containers = await docker.listJarvisContainers()
        const runningNames = new Set(containers.map((c) => c.name))
        const runningDependents = dependents.filter(
          (d) => runningNames.has(`jarvis-${d}`) || runningNames.has(`jarvis_${d}`),
        )
        if (runningDependents.length > 0) {
          reply.code(409).send({
            error: `Cannot disable: the following running modules depend on this one: ${runningDependents.join(', ')}`,
            dependents: runningDependents,
          })
          return
        }
      }
    }

    const profile = service.profile ?? service.id

    try {
      await compose.disableModule(profile)
      reply.send({ success: true, message: `Module ${service.name} disabled` })
    } catch (err) {
      reply.code(500).send({ error: `Failed to disable module: ${(err as Error).message}` })
    }
  })
}
