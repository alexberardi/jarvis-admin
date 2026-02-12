import { existsSync } from 'node:fs'
import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import { type Config, loadConfig } from './config.js'
import { healthRoutes } from './routes/health.js'
import { authRoutes } from './routes/auth.js'
import { settingsRoutes } from './routes/settings.js'
import { trainingRoutes } from './routes/training.js'
import { servicesRoutes } from './routes/services.js'
import { containersRoutes } from './routes/containers.js'
import { systemRoutes } from './routes/system.js'
import { nodesRoutes } from './routes/nodes.js'
import type { DockerService } from './services/docker.js'
import type { ComposeService } from './services/compose.js'
import type { RegistryService } from './services/registry.js'

export interface AppOptions {
  config?: Partial<Config>
  docker?: DockerService | null
  compose?: ComposeService | null
  registry?: RegistryService | null
}

declare module 'fastify' {
  interface FastifyInstance {
    config: Config
    docker: DockerService | null
    compose: ComposeService | null
    registry: RegistryService | null
  }
}

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const config = { ...loadConfig(), ...opts.config }

  const app = Fastify({ logger: false })

  await app.register(cors, { origin: true })

  app.decorate('config', config)
  app.decorate('docker', opts.docker ?? null)
  app.decorate('compose', opts.compose ?? null)
  app.decorate('registry', opts.registry ?? null)

  await app.register(healthRoutes)
  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(settingsRoutes, { prefix: '/api/settings' })
  await app.register(trainingRoutes, { prefix: '/api/training' })
  await app.register(servicesRoutes, { prefix: '/api/services' })
  await app.register(containersRoutes, { prefix: '/api/containers' })
  await app.register(systemRoutes, { prefix: '/api/system' })
  await app.register(nodesRoutes, { prefix: '/api/nodes' })

  // Serve static frontend in production
  if (config.staticDir && existsSync(config.staticDir)) {
    await app.register(fastifyStatic, {
      root: config.staticDir,
      wildcard: false,
    })

    // SPA fallback: serve index.html for non-API routes
    app.setNotFoundHandler((_request, reply) => {
      reply.sendFile('index.html', config.staticDir!)
    })
  }

  return app
}
