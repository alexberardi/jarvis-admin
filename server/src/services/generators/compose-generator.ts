// Compose file generator — produces docker-compose.yml from wizard state
import type { WizardState } from '../../types/wizard.js'
import type {
  ServiceRegistry,
  ServiceDefinition,
  InfrastructureDefinition,
  WorkerDefinition,
} from '../../types/service-registry.js'
import {
  getCoreServices,
  getRecommendedServices,
  getOptionalServices,
  getRequiredInfrastructure,
} from './service-registry.js'
import { serviceIdToPortVar } from './port-utils.js'

/**
 * Returns all enabled services (core + selected recommended + selected optional).
 * On macOS (darwin), filters out GPU services (e.g., llm-proxy) that run natively.
 */
export function getAllEnabledServices(
  state: WizardState,
  registry: ServiceRegistry,
): ServiceDefinition[] {
  const core = getCoreServices(registry)
  const enabledRecommended = getRecommendedServices(registry).filter((s) =>
    state.enabledModules.includes(s.id),
  )
  const enabledOptional = getOptionalServices(registry).filter((s) =>
    state.enabledModules.includes(s.id),
  )
  return [...core, ...enabledRecommended, ...enabledOptional]
}

/**
 * Returns services to include in docker-compose.
 * Excludes GPU services on macOS (they run natively via Metal/MLX).
 */
export function getComposeServices(
  state: WizardState,
  registry: ServiceRegistry,
): ServiceDefinition[] {
  const all = getAllEnabledServices(state, registry)
  if (state.platform === 'darwin') {
    // GPU-required services run natively via Metal/MLX. GPU-optional services
    // (cpuFallback) ship a CPU image and are still useful inside Docker on macOS.
    return all.filter((s) => !s.gpu || s.cpuFallback)
  }
  return all
}

/**
 * GPU types we publish image variants for on `cpuFallback` services.
 * Other GPU types (amd Vulkan, none) fall back to the plain CPU image.
 */
const CPU_FALLBACK_GPU_VARIANTS = new Set<string>(['nvidia', 'amd-rocm'])

/** Whether a service should use a GPU image variant + GPU runtime config for the host. */
function shouldUseGpuVariant(service: ServiceDefinition, gpuType: string | undefined): boolean {
  if (!service.gpu || !gpuType) return false
  if (service.cpuFallback && !CPU_FALLBACK_GPU_VARIANTS.has(gpuType)) return false
  return true
}

/** Worker container IDs emitted alongside the given services in the compose file. */
export function getComposeWorkerIds(services: ServiceDefinition[]): string[] {
  return services.flatMap((s) => (s.workers ?? []).map((w) => w.id))
}

/**
 * Returns all required infrastructure for the enabled services,
 * plus grafana (if loki is present) and redis (always).
 */
function getInfraForServices(
  enabledIds: string[],
  registry: ServiceRegistry,
): InfrastructureDefinition[] {
  const infra = getRequiredInfrastructure(registry, enabledIds)

  const hasLoki = infra.some((i) => i.id === 'loki')
  const grafana = registry.infrastructure.find((i) => i.id === 'grafana')
  if (hasLoki && grafana && !infra.some((i) => i.id === 'grafana')) {
    infra.push(grafana)
  }

  const redis = registry.infrastructure.find((i) => i.id === 'redis')
  if (redis && !infra.some((i) => i.id === 'redis')) {
    infra.push(redis)
  }

  return infra
}

export function generateCompose(state: WizardState, registry: ServiceRegistry): string {
  const composeServices = getComposeServices(state, registry)
  const enabledIds = composeServices.map((s) => s.id)
  const infra = getInfraForServices(enabledIds, registry)

  const lines: string[] = []

  lines.push('services:')

  // Infrastructure first
  for (const inf of infra) {
    lines.push('')
    lines.push(...generateInfraBlock(inf, state))
  }

  // Application services (and any sibling workers)
  for (const service of composeServices) {
    lines.push('')
    lines.push(...generateServiceBlock(service, state, registry))
    if (service.workers) {
      for (const worker of service.workers) {
        lines.push('')
        lines.push(...generateWorkerBlock(worker, service, state, registry))
      }
    }
  }

  // Networks
  lines.push('')
  lines.push('networks:')
  lines.push('  jarvis:')
  lines.push('    driver: bridge')

  // Volumes (top-level): collect named volumes from infra AND services.
  // A volume entry like `name:/path/in/container` is named; bind mounts
  // (e.g. `/var/run/docker.sock:...` or `./path:...`) are not declared here.
  lines.push('')
  lines.push('volumes:')
  const volumes = new Set<string>()
  // A Docker named volume identifier is alphanumeric with limited punctuation.
  // Anything containing /, ., $, or starting with one of those is a host path
  // (bind mount) and must NOT appear in the top-level volumes: section.
  const NAMED_VOLUME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/
  const addIfNamed = (vol: string) => {
    const source = vol.split(':')[0]!
    if (source && NAMED_VOLUME_RE.test(source)) {
      volumes.add(source)
    }
  }
  for (const inf of infra) {
    for (const vol of inf.volumes) addIfNamed(vol)
  }
  for (const svc of composeServices) {
    if (svc.volumes) {
      for (const vol of svc.volumes) addIfNamed(vol)
    }
  }
  for (const vol of volumes) {
    lines.push(`  ${vol}:`)
  }

  lines.push('')
  return lines.join('\n')
}

function generateInfraBlock(
  infra: InfrastructureDefinition,
  state: WizardState,
): string[] {
  const lines: string[] = []
  const portVar = serviceIdToPortVar(infra.id)
  const hostPort = state.infraPortOverrides[infra.id] ?? infra.port

  lines.push(`  ${infra.id}:`)
  lines.push(`    image: ${infra.image}`)
  lines.push(`    container_name: jarvis-${infra.id}`)

  if (infra.port) {
    lines.push('    ports:')
    lines.push(`      - "\${${portVar}:-${hostPort}}:${infra.port}"`)
  }

  // Environment
  if (infra.envVars.length > 0) {
    lines.push('    environment:')
    for (const env of infra.envVars) {
      if (env.secretRef) {
        lines.push(`      ${env.name}: \${${env.secretRef}}`)
      } else {
        const value = env.default ?? ''
        lines.push(`      ${env.name}: \${${env.name}:-${value}}`)
      }
    }
  }

  // Redis needs a command for password auth
  if (infra.id === 'redis') {
    lines.push('    command: redis-server --requirepass ${REDIS_PASSWORD}')
  }

  // Mosquitto needs a config for anonymous access (no config file needed)
  if (infra.id === 'mosquitto') {
    lines.push('    command: ["sh", "-c", "echo -e \'listener 1884\\nallow_anonymous true\\npersistence true\\npersistence_location /mosquitto/data/\' > /tmp/mosquitto.conf && exec mosquitto -c /tmp/mosquitto.conf"]')
  }

  // Postgres needs healthcheck and init-db mount
  if (infra.id === 'postgres') {
    lines.push('    healthcheck:')
    lines.push('      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-jarvis}"]')
    lines.push('      interval: 10s')
    lines.push('      timeout: 5s')
    lines.push('      retries: 5')
    lines.push('    volumes:')
    for (const vol of infra.volumes) {
      lines.push(`      - ${vol}`)
    }
    lines.push('      - ./init-db.sh:/docker-entrypoint-initdb.d/init-db.sh')
  } else if (infra.volumes.length > 0) {
    lines.push('    volumes:')
    for (const vol of infra.volumes) {
      lines.push(`      - ${vol}`)
    }
  }

  lines.push('    networks:')
  lines.push('      - jarvis')
  lines.push('    restart: unless-stopped')

  return lines
}

function getServiceImage(service: ServiceDefinition, state: WizardState): string {
  let image = service.ghcrImage ?? service.image
  if (shouldUseGpuVariant(service, state.hardware?.gpuType)) {
    const variantSuffix: Record<string, string> = {
      nvidia: '-cuda',
      amd: '-vulkan',
      'amd-rocm': '-rocm',
      none: '-cpu',
    }
    const suffix = variantSuffix[state.hardware!.gpuType]
    if (suffix) {
      image = image.includes(':') ? image + suffix : image + ':latest' + suffix
    }
  }
  return image
}

function pushGpuConfig(
  lines: string[],
  service: ServiceDefinition,
  state: WizardState,
): void {
  if (!shouldUseGpuVariant(service, state.hardware?.gpuType)) return
  const gpuType = state.hardware?.gpuType ?? 'none'
  if (gpuType === 'nvidia') {
    lines.push('    ipc: host')
    lines.push('    shm_size: "8gb"')
    lines.push('    deploy:')
    lines.push('      resources:')
    lines.push('        reservations:')
    lines.push('          devices:')
    lines.push('            - driver: nvidia')
    lines.push('              count: all')
    lines.push('              capabilities: [gpu]')
  } else if (gpuType === 'amd' || gpuType === 'amd-rocm') {
    lines.push('    devices:')
    lines.push('      - /dev/dri:/dev/dri')
    lines.push('      - /dev/kfd:/dev/kfd')
    lines.push('    ipc: host')
    lines.push('    shm_size: "8gb"')
    lines.push('    group_add:')
    lines.push('      - video')
    lines.push('      - render')
  } else {
    lines.push('    ipc: host')
  }
}

function generateServiceBlock(
  service: ServiceDefinition,
  state: WizardState,
  registry: ServiceRegistry,
): string[] {
  const lines: string[] = []
  const portVar = serviceIdToPortVar(service.id)
  const hostPort = state.portOverrides[service.id] ?? service.port
  const image = getServiceImage(service, state)

  lines.push(`  ${service.id}:`)
  lines.push(`    image: ${image}`)
  lines.push(`    container_name: ${service.id}`)

  // Ports — containerPort is the port the service listens on inside the container
  // (may differ from the external port when the Dockerfile hardcodes a port)
  const containerPort = service.containerPort ?? service.port
  lines.push('    ports:')
  lines.push(`      - "\${${portVar}:-${hostPort}}:${containerPort}"`)

  // Environment
  lines.push('    environment:')
  // Set port env vars so the service listens on the expected port inside the container.
  // Different services use different env var names for their port.
  const portVarMap: Record<string, string[]> = {
    'jarvis-tts': ['TTS_PORT'],
    'jarvis-logs': ['LOG_SERVER_PORT'],
    'jarvis-notifications': ['NOTIFICATIONS_PORT'],
  }
  const portVarNames = portVarMap[service.id] ?? ['PORT']
  for (const pv of portVarNames) {
    lines.push(`      ${pv}: "${service.port}"`)
  }
  if (service.database) {
    const driver = service.dbDriverPrefix ?? 'postgresql://'
    lines.push(
      `      DATABASE_URL: ${driver}\${DB_USER:-jarvis}:\${POSTGRES_PASSWORD}@postgres:5432/${service.database}`,
    )
    lines.push(
      `      MIGRATIONS_DATABASE_URL: ${driver}\${DB_USER:-jarvis}:\${POSTGRES_PASSWORD}@postgres:5432/${service.database}`,
    )
  }
  const alreadyWritten = new Set(portVarNames)
  for (const env of service.envVars) {
    // Skip vars already written (DATABASE_URL from database field, port vars from portVarMap)
    if (env.name === 'DATABASE_URL' || env.name === 'MIGRATIONS_DATABASE_URL') continue
    if (alreadyWritten.has(env.name)) continue
    if (env.secretRef) {
      lines.push(`      ${env.name}: \${${env.secretRef}}`)
    } else if (env.default) {
      lines.push(`      ${env.name}: ${env.default}`)
    }
  }

  // Whisper model override for non-default models
  const isWhisper = service.id === 'jarvis-whisper-api'
  const nonDefaultWhisper = isWhisper && state.whisperModel !== 'base.en'
  if (nonDefaultWhisper) {
    lines.push(`      WHISPER_MODEL: /models/ggml-${state.whisperModel}.bin`)
  }

  // LLM interface seed for command-center
  if (service.id === 'jarvis-command-center' && state.llmInterface) {
    lines.push(`      LLM_INTERFACE_SEED: ${state.llmInterface}`)
  }

  // Inter-service URLs for remote-llm mode
  if (service.id === 'jarvis-command-center' && state.deploymentMode === 'remote-llm') {
    if (state.remoteLlmUrl) {
      lines.push(`      JARVIS_LLM_PROXY_URL: ${state.remoteLlmUrl}`)
    }
    if (state.remoteWhisperUrl) {
      lines.push(`      JARVIS_WHISPER_URL: ${state.remoteWhisperUrl}`)
    }
  }

  // go2rtc: standalone streaming gateway, no Jarvis auth/config needed
  if (service.id === 'go2rtc') {
    // No app-to-app auth, no extra environment — skip to volumes/network
    lines.push('    volumes:')
    lines.push('      - ./go2rtc.yaml:/config/go2rtc.yaml')
    lines.push('    networks:')
    lines.push('      - jarvis')
    lines.push('    restart: unless-stopped')
    return lines
  }

  // App-to-app auth placeholders (filled after registration)
  lines.push('      JARVIS_APP_ID: ${JARVIS_APP_ID_' + service.id.replace(/^jarvis-/, '').replace(/-/g, '_').toUpperCase() + ':-}')
  lines.push('      JARVIS_APP_KEY: ${JARVIS_APP_KEY_' + service.id.replace(/^jarvis-/, '').replace(/-/g, '_').toUpperCase() + ':-}')

  // Auth URL for all services that depend on jarvis-auth.
  // The ./jarvis CLI injects this into every service's .env (line 599).
  // Needed because auth-client validates before config-client finishes discovery.
  const alreadyHasAuthUrl = service.envVars.some((e) => e.name === 'JARVIS_AUTH_BASE_URL')
  if (service.dependsOn.includes('jarvis-auth') && !alreadyHasAuthUrl) {
    lines.push('      JARVIS_AUTH_BASE_URL: http://host.docker.internal:${AUTH_PORT:-7701}')
  }

  // LLM proxy needs model service config and backend env vars
  if (service.id === 'jarvis-llm-proxy-api') {
    lines.push('      MODEL_SERVICE_URL: http://localhost:7705')
    lines.push('      MODEL_SERVICE_PORT: "7705"')
    lines.push('      VLLM_WORKER_MULTIPROC_METHOD: spawn')
    lines.push('      JARVIS_MODEL_BACKEND: ${JARVIS_MODEL_BACKEND:-GGUF}')
    lines.push('      JARVIS_MODEL_NAME: ${JARVIS_MODEL_NAME:-}')
    lines.push('      JARVIS_MODEL_CHAT_FORMAT: ${JARVIS_MODEL_CHAT_FORMAT:-chatml}')
    lines.push('      JARVIS_MODEL_CONTEXT_WINDOW: ${JARVIS_MODEL_CONTEXT_WINDOW:-32768}')
    lines.push('      HUGGINGFACE_HUB_TOKEN: ${HUGGINGFACE_HUB_TOKEN:-}')
    lines.push('      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379/0')
  }

  // Settings server needs the auth secret for JWT validation
  if (service.id === 'jarvis-settings-server') {
    lines.push('      JARVIS_AUTH_SECRET_KEY: ${AUTH_SECRET_KEY}')
    lines.push('      JARVIS_AUTH_ALGORITHM: HS256')
  }

  // Dependencies
  if (service.dependsOn.length > 0) {
    lines.push('    depends_on:')
    for (const dep of service.dependsOn) {
      const isInfra = registry.infrastructure.some((i) => i.id === dep)
      if (isInfra && dep === 'postgres') {
        lines.push(`      ${dep}:`)
        lines.push('        condition: service_healthy')
      } else {
        lines.push(`      ${dep}:`)
        lines.push('        condition: service_started')
      }
    }
  }

  // Command center: run Alembic migrations before starting the server
  if (service.id === 'jarvis-command-center') {
    lines.push(`    command: ["sh", "-c", "python -m alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${containerPort}"]`)
  }

  // LLM proxy: no CMD in Dockerfile — run migrations, start model service + API
  if (service.id === 'jarvis-llm-proxy-api') {
    lines.push(`    command: ["sh", "-c", "python -m alembic upgrade head && python -m uvicorn services.model_service:app --host 0.0.0.0 --port 7705 & exec python -m uvicorn main:app --host 0.0.0.0 --port 7704"]`)
  }

  pushGpuConfig(lines, service, state)

  // Volumes
  const vols: string[] = []
  if (nonDefaultWhisper) {
    vols.push('      - ./models:/models:ro')
  }
  // modelVolume: only LLM-style services that load weights from disk need this
  // bind. Generic GPU services (like whisper, which bakes its model into the image)
  // shouldn't get a stray .models directory mounted.
  if (service.modelVolume) {
    vols.push('      - ${MODELS_DIR:-./.models}:/app/.models')
  }
  if (service.volumes) {
    for (const vol of service.volumes) {
      vols.push(`      - ${vol}`)
    }
  }
  if (vols.length > 0) {
    lines.push('    volumes:')
    lines.push(...vols)
  }

  // extra_hosts for reaching host services (e.g., native llm-proxy on macOS)
  lines.push('    extra_hosts:')
  lines.push('      - "host.docker.internal:host-gateway"')

  // Healthcheck
  lines.push('    healthcheck:')
  if (service.id === 'jarvis-command-center') {
    // CC image doesn't include curl — use python urllib instead
    lines.push(`      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:${containerPort}${service.healthCheck}')"]`)
  } else {
    lines.push(`      test: ["CMD", "curl", "-f", "http://localhost:${containerPort}${service.healthCheck}"]`)
  }
  lines.push('      interval: 30s')
  lines.push('      timeout: 10s')
  lines.push('      retries: 3')
  // LLM proxy needs extra time for model loading
  if (service.id === 'jarvis-llm-proxy-api') {
    lines.push('      start_period: 120s')
  } else if (service.database) {
    lines.push('      start_period: 30s')
  }

  lines.push('    networks:')
  lines.push('      - jarvis')
  lines.push('    restart: unless-stopped')

  return lines
}

function generateWorkerBlock(
  worker: WorkerDefinition,
  parent: ServiceDefinition,
  state: WizardState,
  registry: ServiceRegistry,
): string[] {
  const lines: string[] = []
  const image = getServiceImage(parent, state)
  const overrides = worker.envOverrides ?? {}
  const overrideKeys = new Set(Object.keys(overrides))

  lines.push(`  ${worker.id}:`)
  lines.push(`    image: ${image}`)
  lines.push(`    container_name: ${worker.id}`)

  lines.push('    environment:')

  if (parent.database) {
    const driver = parent.dbDriverPrefix ?? 'postgresql://'
    const dbUrl = `${driver}\${DB_USER:-jarvis}:\${POSTGRES_PASSWORD}@postgres:5432/${parent.database}`
    if (!overrideKeys.has('DATABASE_URL')) lines.push(`      DATABASE_URL: ${dbUrl}`)
    if (!overrideKeys.has('MIGRATIONS_DATABASE_URL')) {
      lines.push(`      MIGRATIONS_DATABASE_URL: ${dbUrl}`)
    }
  }

  for (const env of parent.envVars) {
    if (env.name === 'DATABASE_URL' || env.name === 'MIGRATIONS_DATABASE_URL') continue
    if (overrideKeys.has(env.name)) continue
    if (env.secretRef) {
      lines.push(`      ${env.name}: \${${env.secretRef}}`)
    } else if (env.default) {
      lines.push(`      ${env.name}: ${env.default}`)
    }
  }

  const appKeySuffix = parent.id.replace(/^jarvis-/, '').replace(/-/g, '_').toUpperCase()
  if (!overrideKeys.has('JARVIS_APP_ID')) {
    lines.push(`      JARVIS_APP_ID: \${JARVIS_APP_ID_${appKeySuffix}:-}`)
  }
  if (!overrideKeys.has('JARVIS_APP_KEY')) {
    lines.push(`      JARVIS_APP_KEY: \${JARVIS_APP_KEY_${appKeySuffix}:-}`)
  }

  const parentHasAuthUrl = parent.envVars.some((e) => e.name === 'JARVIS_AUTH_BASE_URL')
  if (
    parent.dependsOn.includes('jarvis-auth') &&
    !parentHasAuthUrl &&
    !overrideKeys.has('JARVIS_AUTH_BASE_URL')
  ) {
    lines.push('      JARVIS_AUTH_BASE_URL: http://host.docker.internal:${AUTH_PORT:-7701}')
  }

  // Mirror llm-proxy backend env so the worker can resolve models + queue.
  // Override defaults (notably MODEL_SERVICE_URL) come from worker.envOverrides.
  if (parent.id === 'jarvis-llm-proxy-api') {
    const llmProxyEnv: Array<[string, string]> = [
      ['MODEL_SERVICE_URL', 'http://localhost:7705'],
      ['MODEL_SERVICE_PORT', '"7705"'],
      ['VLLM_WORKER_MULTIPROC_METHOD', 'spawn'],
      ['JARVIS_MODEL_BACKEND', '${JARVIS_MODEL_BACKEND:-GGUF}'],
      ['JARVIS_MODEL_NAME', '${JARVIS_MODEL_NAME:-}'],
      ['JARVIS_MODEL_CHAT_FORMAT', '${JARVIS_MODEL_CHAT_FORMAT:-chatml}'],
      ['JARVIS_MODEL_CONTEXT_WINDOW', '${JARVIS_MODEL_CONTEXT_WINDOW:-32768}'],
      ['HUGGINGFACE_HUB_TOKEN', '${HUGGINGFACE_HUB_TOKEN:-}'],
      ['REDIS_URL', 'redis://:${REDIS_PASSWORD}@redis:6379/0'],
    ]
    for (const [key, val] of llmProxyEnv) {
      if (!overrideKeys.has(key)) lines.push(`      ${key}: ${val}`)
    }
  }

  for (const [key, val] of Object.entries(overrides)) {
    lines.push(`      ${key}: ${val}`)
  }

  lines.push(`    command: ${worker.command}`)

  lines.push('    depends_on:')
  lines.push(`      ${parent.id}:`)
  lines.push('        condition: service_healthy')
  for (const dep of parent.dependsOn) {
    const isInfra = registry.infrastructure.some((i) => i.id === dep)
    if (!isInfra) continue
    lines.push(`      ${dep}:`)
    lines.push(`        condition: ${dep === 'postgres' ? 'service_healthy' : 'service_started'}`)
  }

  pushGpuConfig(lines, parent, state)

  const vols: string[] = []
  if (parent.modelVolume) {
    vols.push('      - ${MODELS_DIR:-./.models}:/app/.models')
  }
  if (parent.volumes) {
    for (const vol of parent.volumes) {
      vols.push(`      - ${vol}`)
    }
  }
  if (vols.length > 0) {
    lines.push('    volumes:')
    lines.push(...vols)
  }

  lines.push('    extra_hosts:')
  lines.push('      - "host.docker.internal:host-gateway"')

  lines.push('    networks:')
  lines.push('      - jarvis')
  lines.push('    restart: unless-stopped')

  return lines
}
