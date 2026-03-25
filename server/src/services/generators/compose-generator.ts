import type { WizardState } from '../../types/wizard.js'
import type {
  ServiceRegistry,
  ServiceDefinition,
  InfrastructureDefinition,
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
    return all.filter((s) => !s.gpu)
  }
  return all
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

  // Application services
  for (const service of composeServices) {
    lines.push('')
    lines.push(...generateServiceBlock(service, state, registry))
  }

  // Networks
  lines.push('')
  lines.push('networks:')
  lines.push('  jarvis:')
  lines.push('    driver: bridge')

  // Volumes
  lines.push('')
  lines.push('volumes:')
  const volumes = new Set<string>()
  for (const inf of infra) {
    for (const vol of inf.volumes) {
      volumes.add(vol.split(':')[0]!)
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

function generateServiceBlock(
  service: ServiceDefinition,
  state: WizardState,
  registry: ServiceRegistry,
): string[] {
  const lines: string[] = []
  const portVar = serviceIdToPortVar(service.id)
  const hostPort = state.portOverrides[service.id] ?? service.port
  const image = service.ghcrImage ?? service.image

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
  for (const env of service.envVars) {
    // Skip DATABASE_URL since we generate it from the database field
    if (env.name === 'DATABASE_URL' || env.name === 'MIGRATIONS_DATABASE_URL') continue
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

  // App-to-app auth placeholders (filled after registration)
  lines.push('      JARVIS_APP_ID: ${JARVIS_APP_ID_' + service.id.replace(/^jarvis-/, '').replace(/-/g, '_').toUpperCase() + ':-}')
  lines.push('      JARVIS_APP_KEY: ${JARVIS_APP_KEY_' + service.id.replace(/^jarvis-/, '').replace(/-/g, '_').toUpperCase() + ':-}')

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

  // LLM proxy has no CMD in Dockerfile — compose must provide the command
  if (service.id === 'jarvis-llm-proxy-api') {
    lines.push('    command: >-')
    lines.push('      python -m uvicorn main:app')
    lines.push('      --host 0.0.0.0')
    lines.push('      --port 7704')
  }

  // GPU services: NVIDIA deploy config, ipc, shm_size, model volume
  const isGpu = service.gpu === true
  if (isGpu) {
    lines.push('    ipc: host')
    lines.push('    shm_size: "8gb"')
    lines.push('    deploy:')
    lines.push('      resources:')
    lines.push('        reservations:')
    lines.push('          devices:')
    lines.push('            - driver: nvidia')
    lines.push('              count: all')
    lines.push('              capabilities: [gpu]')
  }

  // Volumes
  const vols: string[] = []
  if (nonDefaultWhisper) {
    vols.push('      - ./models:/models:ro')
  }
  if (isGpu) {
    vols.push('      - ${MODELS_DIR:-./.models}:/app/.models:ro')
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
  lines.push(`      test: ["CMD", "curl", "-f", "http://localhost:${containerPort}${service.healthCheck}"]`)
  lines.push('      interval: 30s')
  lines.push('      timeout: 10s')
  lines.push('      retries: 3')

  lines.push('    networks:')
  lines.push('      - jarvis')
  lines.push('    restart: unless-stopped')

  return lines
}
