export interface Config {
  port: number
  authUrl: string
  configServiceUrl: string
  llmProxyUrl: string
  commandCenterUrl: string
  commandCenterAdminKey: string
  dockerSocket: string
  registryPath: string | null
  staticDir: string | null
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    port: parseInt(env.PORT ?? '3000', 10),
    authUrl: env.AUTH_URL ?? 'http://localhost:8007',
    configServiceUrl: env.CONFIG_SERVICE_URL ?? 'http://localhost:8013',
    llmProxyUrl: env.LLM_PROXY_URL ?? 'http://localhost:8000',
    commandCenterUrl: env.COMMAND_CENTER_URL ?? 'http://localhost:8002',
    commandCenterAdminKey: env.COMMAND_CENTER_ADMIN_KEY ?? '',
    dockerSocket: env.DOCKER_SOCKET ?? '/var/run/docker.sock',
    registryPath: env.REGISTRY_PATH ?? null,
    staticDir: env.STATIC_DIR ?? null,
  }
}
