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
import { resolveServiceUrls } from './services/configService.js'
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

/** Map short service names from config-service to Config property names. */
const SERVICE_NAME_TO_CONFIG: Record<string, keyof Config> = {
  auth: 'authUrl',
  'llm-proxy': 'llmProxyUrl',
  'command-center': 'commandCenterUrl',
}

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const config = { ...loadConfig(), ...opts.config }

  // Resolve service URLs from config-service (override localhost defaults)
  try {
    const serviceMap = await resolveServiceUrls(config.configServiceUrl)
    for (const [serviceName, configKey] of Object.entries(SERVICE_NAME_TO_CONFIG)) {
      const url = serviceMap.get(serviceName)
      if (url) {
        ;(config as Record<string, unknown>)[configKey] = url
      }
    }
  } catch (err) {
    console.warn(
      `[jarvis-admin] Could not resolve service URLs from config-service at ${config.configServiceUrl}: ${err instanceof Error ? err.message : err}. Using defaults.`
    )
  }

  if (!config.authUrl) {
    throw new Error('AUTH_URL is required. Set it in your environment or register "auth" in config-service.')
  }

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
