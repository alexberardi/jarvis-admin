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
  /** Allowed CORS origins for the admin API. Empty = same-origin only (no
   *  cross-origin reflection). Set JARVIS_ADMIN_CORS_ORIGINS to a
   *  comma-separated allowlist (e.g. "http://localhost:5173"). */
  corsOrigins: string[]
  /** Global, box-level opt-in for outbound update checks + self-update.
   *  Defaults to false (fully local; no outbound internet unless opted in).
   *  Set JARVIS_ALLOW_UPDATES=true to allow GitHub release checks and applies. */
  allowUpdates: boolean
}

/** Persisted service URLs and version info from the setup wizard. */
interface PersistedConfig {
  authUrl?: string
  configServiceUrl?: string
  llmProxyUrl?: string
  commandCenterUrl?: string
  installedVersion?: string
  installed?: boolean
  allowUpdates?: boolean
}

export function isInstalled(): boolean {
  return loadPersistedConfig().installed === true
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
    authUrl: persisted.authUrl ?? env.JARVIS_AUTH_BASE_URL ?? env.AUTH_URL ?? '',
    configServiceUrl: persisted.configServiceUrl ?? env.JARVIS_CONFIG_URL ?? env.CONFIG_SERVICE_URL ?? '',
    llmProxyUrl: persisted.llmProxyUrl ?? env.JARVIS_LLM_PROXY_URL ?? env.LLM_PROXY_URL ?? '',
    commandCenterUrl: persisted.commandCenterUrl ?? env.JARVIS_COMMAND_CENTER_URL ?? env.COMMAND_CENTER_URL ?? '',
    commandCenterAdminKey: env.COMMAND_CENTER_ADMIN_KEY ?? '',
    dockerSocket: env.DOCKER_SOCKET ?? (process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock'),
    registryPath: env.REGISTRY_PATH ?? null,
    staticDir: env.STATIC_DIR ?? null,
    corsOrigins: (env.JARVIS_ADMIN_CORS_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0),
    // Default false: fully local, no outbound update checks unless opted in.
    allowUpdates:
      (persisted.allowUpdates ??
        (env.JARVIS_ALLOW_UPDATES === 'true' || env.JARVIS_ALLOW_UPDATES === '1')) === true,
  }
}
