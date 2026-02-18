import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

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

/** Persisted service URLs from the setup wizard. */
interface PersistedConfig {
  authUrl?: string
  configServiceUrl?: string
  llmProxyUrl?: string
  commandCenterUrl?: string
}

const CONFIG_DIR = join(homedir(), '.jarvis')
const CONFIG_FILE = join(CONFIG_DIR, 'admin.json')

function loadPersistedConfig(): PersistedConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as PersistedConfig
    }
  } catch {
    // Corrupted file — start fresh
  }
  return {}
}

export function savePersistedConfig(urls: PersistedConfig): void {
  const existing = loadPersistedConfig()
  const merged = { ...existing, ...urls }
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2) + '\n')
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const persisted = loadPersistedConfig()

  return {
    port: parseInt(env.PORT ?? '7711', 10),
    // Priority: persisted (from setup wizard) > env var > empty (triggers setup wizard)
    authUrl: persisted.authUrl ?? env.AUTH_URL ?? '',
    configServiceUrl: persisted.configServiceUrl ?? env.CONFIG_SERVICE_URL ?? '',
    llmProxyUrl: persisted.llmProxyUrl ?? env.LLM_PROXY_URL ?? '',
    commandCenterUrl: persisted.commandCenterUrl ?? env.COMMAND_CENTER_URL ?? '',
    commandCenterAdminKey: env.COMMAND_CENTER_ADMIN_KEY ?? '',
    dockerSocket: env.DOCKER_SOCKET ?? '/var/run/docker.sock',
    registryPath: env.REGISTRY_PATH ?? null,
    staticDir: env.STATIC_DIR ?? null,
  }
}
