/**
 * Service URL discovery from jarvis-config-service.
 *
 * Fetches all registered services and returns a map of service name → URL.
 * Service names use short form (e.g., "auth", "llm-proxy", "command-center").
 */

export type ServiceMap = Map<string, string>

interface ServiceEntry {
  name: string
  url: string
  host: string
  port: number
}

interface ServicesResponse {
  services: ServiceEntry[]
}

/**
 * Resolve service URLs from jarvis-config-service.
 *
 * @param configServiceUrl - Base URL of config-service (e.g., "http://localhost:7700")
 * @returns Map of service name → URL
 * @throws Error if config-service is unreachable
 */
export async function resolveServiceUrls(configServiceUrl: string): Promise<ServiceMap> {
  const url = `${configServiceUrl.replace(/\/$/, '')}/services`

  const response = await fetch(url, {
    signal: AbortSignal.timeout(5000),
  })

  if (!response.ok) {
    throw new Error(`Config service returned ${response.status}: ${response.statusText}`)
  }

  const data = (await response.json()) as ServicesResponse
  const map: ServiceMap = new Map()

  for (const svc of data.services) {
    map.set(svc.name, svc.url)
  }

  return map
}
