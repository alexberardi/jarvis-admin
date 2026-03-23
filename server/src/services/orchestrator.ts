import type { ServiceDefinition, ServiceRegistry } from '../types/service-registry.js'
import type { HealthStatus, RegisterResult } from '../types/wizard.js'

/**
 * Service tiers for ordered health polling.
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

  // Build fast lookup
  const serviceMap = new Map(services.map((s) => [s.id, s]))

  // Poll tiered services first
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

  // Then all remaining services in parallel
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
 * Register services with config-service.
 * Config-service auto-creates app-clients in auth and returns app keys.
 */
export async function registerServices(
  services: ServiceDefinition[],
  configServiceUrl: string,
  adminToken: string,
  portOverrides: Record<string, number>,
): Promise<RegisterResult> {
  const registered: string[] = []
  const failed: Array<{ serviceId: string; error: string }> = []

  for (const svc of services) {
    const port = portOverrides[svc.id] ?? svc.port
    try {
      const res = await fetch(`${configServiceUrl}/v1/services/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': adminToken,
        },
        body: JSON.stringify({
          name: svc.id,
          display_name: svc.name,
          description: svc.description,
          url: `http://${svc.id}:${svc.port}`,
          health_check_url: `http://${svc.id}:${svc.port}${svc.healthCheck}`,
          port,
        }),
        signal: AbortSignal.timeout(10_000),
      })

      if (res.ok) {
        registered.push(svc.id)
      } else {
        const body = await res.text()
        failed.push({ serviceId: svc.id, error: `HTTP ${res.status}: ${body}` })
      }
    } catch (err) {
      failed.push({
        serviceId: svc.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    registered,
    failed,
    needsRestart: registered.length > 0,
  }
}

/**
 * Update .env file with app keys returned from registration.
 * Returns the updated env content.
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
 * Get default enabled modules (recommended services).
 */
export function getDefaultEnabledModules(registry: ServiceRegistry): string[] {
  return registry.services
    .filter((s) => s.category === 'recommended')
    .map((s) => s.id)
}
