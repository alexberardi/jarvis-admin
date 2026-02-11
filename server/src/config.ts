export interface Config {
  port: number
  authUrl: string
  configServiceUrl: string
  dockerSocket: string
  registryPath: string | null
  staticDir: string | null
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    port: parseInt(env.PORT ?? '3000', 10),
    authUrl: env.AUTH_URL ?? 'http://localhost:8007',
    configServiceUrl: env.CONFIG_SERVICE_URL ?? 'http://localhost:8013',
    dockerSocket: env.DOCKER_SOCKET ?? '/var/run/docker.sock',
    registryPath: env.REGISTRY_PATH ?? null,
    staticDir: env.STATIC_DIR ?? null,
  }
}
