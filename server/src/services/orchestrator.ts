import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execSync, spawn } from 'node:child_process'
import type { ServiceDefinition, ServiceRegistry } from '../types/service-registry.js'
import type { HealthStatus, RegisterResult } from '../types/wizard.js'

/**
 * Service tiers for ordered startup and health polling.
 * Higher tiers depend on lower tiers being healthy.
 */
const TIER_ORDER = [
  ['jarvis-config-service'],
  ['jarvis-auth'],
  ['jarvis-logs'],
  // Everything else
] as const

/**
 * Poll health endpoints for all enabled services, tier by tier.
 */
export async function pollServiceHealth(
  services: ServiceDefinition[],
  portOverrides: Record<string, number>,
  hostOverride?: string,
): Promise<HealthStatus> {
  const status: HealthStatus = {}
  const host = hostOverride ?? 'localhost'

  const serviceMap = new Map(services.map((s) => [s.id, s]))

  for (const tier of TIER_ORDER) {
    for (const id of tier) {
      const svc = serviceMap.get(id)
      if (!svc) continue
      serviceMap.delete(id)
      const port = portOverrides[id] ?? svc.port
      const url = `http://${host}:${port}${svc.healthCheck}`
      status[id] = await checkHealth(url)
    }
  }

  const remaining = [...serviceMap.values()]
  const results = await Promise.all(
    remaining.map(async (svc) => {
      const port = portOverrides[svc.id] ?? svc.port
      const url = `http://${host}:${port}${svc.healthCheck}`
      return { id: svc.id, result: await checkHealth(url) }
    }),
  )
  for (const { id, result } of results) {
    status[id] = result
  }

  return status
}

async function checkHealth(url: string): Promise<{ healthy: boolean; url: string; error?: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (res.ok) {
      return { healthy: true, url }
    }
    return { healthy: false, url, error: `HTTP ${res.status}` }
  } catch (err) {
    return { healthy: false, url, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Wait for a service to become healthy, polling every 2 seconds.
 */
async function waitForHealth(
  host: string, port: number, healthPath: string, maxWaitSeconds: number,
): Promise<boolean> {
  const url = `http://${host}:${port}${healthPath}`
  const deadline = Date.now() + maxWaitSeconds * 1000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
      if (res.ok) return true
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  return false
}

/**
 * Register all services with config-service using the batch endpoint.
 * Config-service auto-creates app-clients in auth and returns app keys.
 * Injects the keys into the .env file.
 */
export async function registerServices(
  services: ServiceDefinition[],
  configServiceUrl: string,
  adminToken: string,
  portOverrides: Record<string, number>,
  composePath?: string,
): Promise<RegisterResult> {
  // Register with host.docker.internal so Docker containers can reach services
  // via host port mapping. This also supports future multi-machine deployments
  // where remote services would be re-registered with their actual IP.
  const serviceList = services
    .filter((s) => s.id !== 'jarvis-admin') // Admin doesn't need registration
    .map((s) => ({
      name: s.id,
      host: 'host.docker.internal',
      port: portOverrides[s.id] ?? s.port,
    }))

  try {
    const res = await fetch(`${configServiceUrl}/v1/services/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Jarvis-Admin-Token': adminToken,
      },
      body: JSON.stringify({ services: serviceList }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      const body = await res.text()
      return {
        registered: [],
        failed: [{ serviceId: 'batch', error: `HTTP ${res.status}: ${body}` }],
        needsRestart: false,
      }
    }

    const data = await res.json() as {
      results: Array<{
        name: string
        auth_created?: boolean
        auth_ok?: boolean
        app_key?: string
      }>
    }

    const registered: string[] = []
    const failed: Array<{ serviceId: string; error: string }> = []
    const appKeys: Record<string, { appId: string; appKey: string }> = {}

    for (const r of data.results ?? []) {
      registered.push(r.name)
      if (r.app_key) {
        appKeys[r.name] = { appId: r.name, appKey: r.app_key }
      }
    }

    // Inject app keys into .env file
    if (composePath && Object.keys(appKeys).length > 0) {
      const envFile = join(composePath, '.env')
      if (existsSync(envFile)) {
        let envContent = readFileSync(envFile, 'utf-8')
        envContent = injectAppKeys(envContent, appKeys)
        writeFileSync(envFile, envContent)
      }
    }

    return {
      registered,
      failed,
      needsRestart: Object.keys(appKeys).length > 0,
      appKeys,
    }
  } catch (err) {
    return {
      registered: [],
      failed: [{ serviceId: 'batch', error: err instanceof Error ? err.message : String(err) }],
      needsRestart: false,
    }
  }
}

/**
 * Update .env file with app keys returned from registration.
 */
export function injectAppKeys(
  envContent: string,
  appKeys: Record<string, { appId: string; appKey: string }>,
): string {
  let updated = envContent
  for (const [serviceId, { appId, appKey }] of Object.entries(appKeys)) {
    const suffix = serviceId.replace(/^jarvis-/, '').replace(/-/g, '_').toUpperCase()
    updated = updated.replace(
      new RegExp(`JARVIS_APP_ID_${suffix}=.*`),
      `JARVIS_APP_ID_${suffix}=${appId}`,
    )
    updated = updated.replace(
      new RegExp(`JARVIS_APP_KEY_${suffix}=.*`),
      `JARVIS_APP_KEY_${suffix}=${appKey}`,
    )
  }
  return updated
}

/**
 * Run tiered startup: start services in dependency order, wait for health,
 * register, inject keys, restart services that got new credentials.
 *
 * Emits SSE events for UI progress.
 */
export async function tieredStartup(
  composeFile: string,
  composePath: string,
  services: ServiceDefinition[],
  adminToken: string,
  portOverrides: Record<string, number>,
  emit: (data: Record<string, unknown>) => void,
): Promise<{ success: boolean; error?: string }> {
  const env = { ...process.env, ...loadEnvFromFile(composePath) }
  const configPort = portOverrides['jarvis-config-service'] ?? 7700
  const authPort = portOverrides['jarvis-auth'] ?? 7701

  const composeCmd = (args: string[]) =>
    new Promise<number>((resolve) => {
      const child = spawn('docker', ['compose', '-f', composeFile, ...args], {
        cwd: composePath,
        env,
      })
      child.stdout.on('data', (chunk: Buffer) => {
        emit({ stream: 'stdout', text: chunk.toString() })
      })
      child.stderr.on('data', (chunk: Buffer) => {
        emit({ stream: 'stderr', text: chunk.toString() })
      })
      child.on('close', (code) => resolve(code ?? 1))
    })

  // Step 1: Start infrastructure (postgres, redis, loki, grafana)
  emit({ phase: 'infra', message: 'Starting infrastructure...' })
  await composeCmd(['up', '-d', 'postgres', 'redis', 'loki', 'grafana'])

  // Wait for postgres to be healthy
  emit({ phase: 'infra', message: 'Waiting for PostgreSQL...' })
  for (let i = 0; i < 30; i++) {
    try {
      execSync('docker exec jarvis-postgres pg_isready -U jarvis', { timeout: 3000, stdio: 'pipe' })
      break
    } catch {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }

  // Step 2: Start config-service (tier 0)
  emit({ phase: 'tier0', message: 'Starting config-service...' })
  await composeCmd(['up', '-d', 'jarvis-config-service'])
  emit({ phase: 'tier0', message: 'Waiting for config-service to be healthy...' })
  const configHealthy = await waitForHealth('localhost', configPort, '/health', 30)
  if (!configHealthy) {
    return { success: false, error: 'config-service failed to start' }
  }

  // Step 3: Start auth (tier 1)
  emit({ phase: 'tier1', message: 'Starting auth service...' })
  await composeCmd(['up', '-d', 'jarvis-auth'])
  emit({ phase: 'tier1', message: 'Waiting for auth to be healthy...' })
  const authHealthy = await waitForHealth('localhost', authPort, '/health', 30)
  if (!authHealthy) {
    return { success: false, error: 'auth service failed to start' }
  }

  // Step 4: Register all services + get app keys
  emit({ phase: 'register', message: 'Registering services and generating credentials...' })
  const configServiceUrl = `http://localhost:${configPort}`
  const enabledServices = services.filter((s) => s.category === 'core' || s.category === 'recommended' || s.category === 'optional')
  const regResult = await registerServices(enabledServices, configServiceUrl, adminToken, portOverrides, composePath)

  if (regResult.failed.length > 0) {
    emit({ phase: 'register', message: `Warning: ${regResult.failed.length} service(s) failed to register` })
  }
  if (regResult.registered.length > 0) {
    emit({ phase: 'register', message: `Registered ${regResult.registered.length} service(s)` })
  }

  // Step 5: Start remaining services (skip tier 0-1 — they're already healthy)
  const alreadyRunning = new Set(['jarvis-config-service', 'jarvis-auth'])
  const remaining = services
    .filter((s) => !alreadyRunning.has(s.id))
    .map((s) => s.id)

  emit({ phase: 'services', message: `Starting ${remaining.length} remaining services...` })
  // Reload env after key injection
  const updatedEnv = { ...process.env, ...loadEnvFromFile(composePath) }
  const child = spawn('docker', ['compose', '-f', composeFile, 'up', '-d', '--force-recreate', ...remaining], {
    cwd: composePath,
    env: updatedEnv,
  })
  await new Promise<void>((resolve) => {
    child.stdout.on('data', (chunk: Buffer) => {
      emit({ stream: 'stdout', text: chunk.toString() })
    })
    child.stderr.on('data', (chunk: Buffer) => {
      emit({ stream: 'stderr', text: chunk.toString() })
    })
    child.on('close', () => resolve())
  })

  emit({ phase: 'done', message: 'All services started' })
  return { success: true }
}

function loadEnvFromFile(composePath: string): Record<string, string> {
  const envFile = join(composePath, '.env')
  if (!existsSync(envFile)) return {}

  const vars: Record<string, string> = {}
  const content = readFileSync(envFile, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1)
  }
  return vars
}

/**
 * Get default enabled modules (recommended services).
 */
export function getDefaultEnabledModules(registry: ServiceRegistry): string[] {
  return registry.services
    .filter((s) => s.category === 'recommended')
    .map((s) => s.id)
}
