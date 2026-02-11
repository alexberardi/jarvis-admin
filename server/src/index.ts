import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { createDockerService } from './services/docker.js'
import { createComposeService } from './services/compose.js'
import { createRegistryService } from './services/registry.js'

async function main(): Promise<void> {
  const config = loadConfig()

  const docker = await createDockerService(config.dockerSocket)
  const compose = createComposeService()
  const registry = config.registryPath ? createRegistryService(config.registryPath) : null

  const app = await buildApp({ config, docker, compose, registry })

  await app.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`jarvis-admin server listening on port ${config.port}`)
}

main().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
