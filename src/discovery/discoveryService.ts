const CONFIG_CACHE_KEY = 'jarvis-config-service-url'
const PROBE_TIMEOUT_MS = 800
const PORTS = [8013, 8014, 8015, 8016, 8017, 8018, 8019, 8020]
const SUBNET_BATCH_SIZE = 20

export interface DiscoveryResult {
  configUrl: string
  authUrl: string
  settingsUrl: string
}

interface InfoResponse {
  service: string
}

interface ServiceResponse {
  name: string
  host: string
  port: number
  scheme: string
}

async function probeForConfigService(host: string, port: number): Promise<string | null> {
  const url = `http://${host}:${port}`
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    const response = await fetch(`${url}/info`, { signal: controller.signal })
    clearTimeout(timeout)
    if (!response.ok) return null
    const data: InfoResponse = await response.json()
    return data.service === 'jarvis-config-service' ? url : null
  } catch {
    return null
  }
}

async function scanLocalhost(): Promise<string | null> {
  const results = await Promise.all(PORTS.map((port) => probeForConfigService('localhost', port)))
  return results.find((url) => url !== null) ?? null
}

async function getLocalIp(): Promise<string | null> {
  try {
    const pc = new RTCPeerConnection({ iceServers: [] })
    pc.createDataChannel('')
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    return new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => {
        pc.close()
        resolve(null)
      }, 3000)

      pc.onicecandidate = (event) => {
        if (!event.candidate) return
        const match = event.candidate.candidate.match(
          /([0-9]{1,3}\.){3}[0-9]{1,3}/,
        )
        if (match) {
          clearTimeout(timeout)
          pc.close()
          resolve(match[0])
        }
      }
    })
  } catch {
    return null
  }
}

function getSubnetAddresses(localIp: string): string[] {
  const parts = localIp.split('.')
  const prefix = parts.slice(0, 3).join('.')
  const localLast = parseInt(parts[3], 10)
  const addresses: string[] = []
  for (let i = 1; i <= 254; i++) {
    if (i !== localLast) {
      addresses.push(`${prefix}.${i}`)
    }
  }
  return addresses
}

async function scanSubnet(localIp: string): Promise<string | null> {
  const addresses = getSubnetAddresses(localIp)

  for (let i = 0; i < addresses.length; i += SUBNET_BATCH_SIZE) {
    const batch = addresses.slice(i, i + SUBNET_BATCH_SIZE)
    const probes = batch.flatMap((host) =>
      PORTS.map((port) => probeForConfigService(host, port)),
    )
    const results = await Promise.all(probes)
    const found = results.find((url) => url !== null)
    if (found) return found
  }
  return null
}

async function resolveServiceUrls(
  configUrl: string,
): Promise<{ authUrl: string; settingsUrl: string }> {
  // Settings API lives on the config service itself (/v1/settings)
  // Only jarvis-auth needs to be resolved from the registry
  const authResp = await fetch(`${configUrl}/services/jarvis-auth`)

  if (!authResp.ok) throw new Error('Failed to resolve jarvis-auth from config service')

  const auth: ServiceResponse = await authResp.json()

  return {
    authUrl: `${auth.scheme}://${auth.host}:${auth.port}`,
    settingsUrl: configUrl,
  }
}

async function checkCachedConfig(): Promise<string | null> {
  const cached = localStorage.getItem(CONFIG_CACHE_KEY)
  if (!cached) return null
  const result = await probeForConfigService(new URL(cached).hostname, parseInt(new URL(cached).port, 10))
  return result
}

export async function discover(): Promise<DiscoveryResult> {
  // 1. Check cache
  let configUrl = await checkCachedConfig()

  // 2. Scan localhost
  if (!configUrl) {
    configUrl = await scanLocalhost()
  }

  // 3. Scan subnet
  if (!configUrl) {
    const localIp = await getLocalIp()
    if (localIp) {
      configUrl = await scanSubnet(localIp)
    }
  }

  if (!configUrl) {
    throw new Error('Could not find jarvis-config-service on the network')
  }

  // Cache the discovered URL
  localStorage.setItem(CONFIG_CACHE_KEY, configUrl)

  // Resolve service URLs
  const { authUrl, settingsUrl } = await resolveServiceUrls(configUrl)

  return { configUrl, authUrl, settingsUrl }
}
