import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, accessSync, constants as fsConstants } from 'node:fs'
import { join } from 'node:path'
import { homedir, platform, arch, totalmem } from 'node:os'
import { spawn, execSync } from 'node:child_process'
import net from 'node:net'
import type { FastifyInstance } from 'fastify'
import { generateCompose, getAllEnabledServices } from '../services/generators/compose-generator.js'
import { generateEnv } from '../services/generators/env-generator.js'
import { generateInitDbScript } from '../services/generators/init-db-generator.js'
import { generateAllSecrets } from '../services/generators/secret-generator.js'
import { parseRegistry } from '../services/generators/service-registry.js'
import { pollServiceHealth, registerServices, tieredStartup, getDefaultEnabledModules } from '../services/orchestrator.js'
import { savePersistedConfig } from '../config.js'
import type { WizardState, HardwareInfo, InstallState, PreflightCheck, PreflightResult } from '../types/wizard.js'
import type { ServiceRegistry } from '../types/service-registry.js'
import registryData from '../data/service-registry.json' with { type: 'json' }

function getComposePath(): string {
  return join(homedir(), '.jarvis', 'compose')
}

function loadRegistry(): ServiceRegistry {
  return parseRegistry(registryData)
}

export async function installRoutes(app: FastifyInstance): Promise<void> {
  const registry = loadRegistry()

  /**
   * Check installation state with container awareness.
   */
  app.get('/status', async (_request, reply) => {
    // Compose-export mode: services are managed externally (TrueNAS, Portainer, etc.)
    // Just check if auth is reachable and whether account setup is needed.
    if (process.env.JARVIS_DEPLOY_MODE === 'compose-export') {
      // Try to reach auth to determine if account creation is needed
      const authUrl = process.env.JARVIS_AUTH_BASE_URL ?? 'http://jarvis-auth:8000'
      let authReachable = false
      try {
        const res = await fetch(`${authUrl}/health`, { signal: AbortSignal.timeout(3000) })
        authReachable = res.ok
      } catch {
        // Auth not reachable yet
      }

      if (!authReachable) {
        // Services still starting
        const status: InstallState = {
          configured: false,
          state: 'deployed-needs-account',
          deployMode: 'compose-export',
          reason: 'services_starting',
        }
        return reply.send(status)
      }

      const status: InstallState = {
        configured: false,
        state: 'deployed-needs-account',
        deployMode: 'compose-export',
      }
      return reply.send(status)
    }

    const composePath = getComposePath()
    const composeFile = join(composePath, 'docker-compose.yml')
    const envFile = join(composePath, '.env')

    if (!existsSync(composeFile) || !existsSync(envFile)) {
      // Check Docker availability
      let dockerAvailable = false
      try {
        execSync('docker info', { stdio: 'ignore', timeout: 5000 })
        dockerAvailable = true
      } catch {
        // Docker not available
      }

      const status: InstallState = {
        configured: false,
        reason: dockerAvailable ? 'not_installed' : 'docker_not_found',
        state: 'fresh',
      }
      return reply.send(status)
    }

    // Compose file exists — check what containers are running
    const running: string[] = []
    const stopped: string[] = []
    try {
      const output = execSync(
        `docker compose -f "${composeFile}" ps --format json`,
        { cwd: composePath, timeout: 10_000, encoding: 'utf-8', env: { ...process.env, ...loadEnvFile(composePath) } },
      )
      // docker compose ps --format json outputs one JSON object per line
      const lines = output.trim().split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const container = JSON.parse(line) as { Service: string; State: string }
          if (container.State === 'running') {
            running.push(container.Service)
          } else {
            stopped.push(container.Service)
          }
        } catch {
          // Skip unparseable lines
        }
      }
    } catch {
      // docker compose ps failed — compose file may exist but no containers
    }

    // Determine state
    let state: 'generated' | 'partial' | 'running' | 'complete' = 'generated'
    if (running.length === 0 && stopped.length === 0) {
      state = 'generated'
    } else if (running.length > 0 && stopped.length === 0) {
      // All containers running — check if auth is up (indicates complete setup)
      const envVars = loadEnvFile(composePath)
      const authPort = parseInt(envVars.AUTH_PORT ?? '7701', 10)
      try {
        const res = await fetch(`http://localhost:${authPort}/health`, { signal: AbortSignal.timeout(3000) })
        if (res.ok) {
          state = 'complete'
        } else {
          state = 'running'
        }
      } catch {
        state = 'running'
      }
    } else {
      state = 'partial'
    }

    const status: InstallState = {
      configured: true,
      composePath,
      state,
      running: running.length > 0 ? running : undefined,
      stopped: stopped.length > 0 ? stopped : undefined,
    }
    return reply.send(status)
  })

  /**
   * Pre-flight checks before installation begins.
   * Verifies Docker, Compose, ports, disk space, Docker socket, and NVIDIA runtime.
   */
  app.get<{ Querystring: { services?: string } }>('/preflight', async (request, reply) => {
    const checks: PreflightCheck[] = []
    const composePath = getComposePath()
    const dockerSocket = app.config?.dockerSocket ?? (process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock')

    // Parse enabled services from query param
    const enabledServiceIds = (request.query as { services?: string }).services?.split(',').filter(Boolean) ?? []
    const enabledServices = registry.services.filter((s) =>
      s.category === 'core' || enabledServiceIds.includes(s.id),
    )

    // 1. Docker
    try {
      const output = execSync('docker info', { encoding: 'utf-8', timeout: 5000 })
      const versionMatch = output.match(/Server Version:\s*(.+)/i)
      const version = versionMatch?.[1]?.trim() ?? 'unknown'
      checks.push({ name: 'Docker', status: 'pass', message: `Docker is running (v${version})` })
    } catch (err) {
      checks.push({
        name: 'Docker',
        status: 'fail',
        message: 'Docker is not running or not installed',
        details: err instanceof Error ? err.message : String(err),
      })
    }

    // 2. Docker Compose
    try {
      const output = execSync('docker compose version', { encoding: 'utf-8', timeout: 5000 })
      checks.push({ name: 'Docker Compose', status: 'pass', message: output.trim() })
    } catch (err) {
      checks.push({
        name: 'Docker Compose',
        status: 'fail',
        message: 'Docker Compose is not available',
        details: err instanceof Error ? err.message : String(err),
      })
    }

    // 3. Port availability
    const portsToCheck = enabledServices.map((s) => ({ id: s.id, port: s.port }))
    const conflicts: Array<{ id: string; port: number }> = []

    await Promise.all(
      portsToCheck.map(async ({ id, port }) => {
        const inUse = await isPortInUse(port)
        if (inUse) {
          conflicts.push({ id, port })
        }
      }),
    )

    if (conflicts.length > 0) {
      const coreConflicts = conflicts.filter((c) =>
        enabledServices.find((s) => s.id === c.id && s.category === 'core'),
      )
      const details = conflicts.map((c) => `${c.id} (port ${c.port})`).join(', ')
      checks.push({
        name: 'Ports',
        status: coreConflicts.length > 0 ? 'fail' : 'warn',
        message: `${conflicts.length} port(s) already in use: ${details}`,
        details: `Conflicting ports: ${details}`,
      })
    } else {
      checks.push({ name: 'Ports', status: 'pass', message: 'All required ports are available' })
    }

    // 4. Disk space
    try {
      const targetPath = existsSync(composePath) ? composePath : homedir()
      const output = execSync(`df -k "${targetPath}"`, { encoding: 'utf-8', timeout: 5000 })
      const lines = output.trim().split('\n')
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/)
        // df -k output: Filesystem 1K-blocks Used Available Use% Mounted
        const availableKb = parseInt(parts[3], 10)
        const availableGb = Math.round(availableKb / (1024 * 1024))
        if (availableKb < 2 * 1024 * 1024) {
          checks.push({
            name: 'Disk Space',
            status: 'fail',
            message: `Only ${availableGb} GB available (minimum 2 GB required)`,
          })
        } else if (availableKb < 10 * 1024 * 1024) {
          checks.push({
            name: 'Disk Space',
            status: 'warn',
            message: `${availableGb} GB available (10+ GB recommended)`,
          })
        } else {
          checks.push({
            name: 'Disk Space',
            status: 'pass',
            message: `${availableGb} GB available`,
          })
        }
      }
    } catch {
      checks.push({ name: 'Disk Space', status: 'warn', message: 'Could not determine available disk space' })
    }

    // 5. Docker socket
    try {
      if (platform() === 'win32') {
        // Windows named pipes can't be checked with accessSync — verify via docker ping
        execSync('docker info', { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' })
        checks.push({ name: 'Docker Socket', status: 'pass', message: `Docker Desktop accessible via named pipe` })
      } else {
        accessSync(dockerSocket, fsConstants.R_OK | fsConstants.W_OK)
        checks.push({ name: 'Docker Socket', status: 'pass', message: `Docker socket accessible at ${dockerSocket}` })
      }
    } catch (err) {
      checks.push({
        name: 'Docker Socket',
        status: 'fail',
        message: platform() === 'win32'
          ? 'Docker Desktop not running or not accessible'
          : `Docker socket not accessible at ${dockerSocket}`,
        details: err instanceof Error ? err.message : String(err),
      })
    }

    // 6. NVIDIA runtime (Linux only)
    if (platform() === 'linux') {
      const gpuServicesEnabled = enabledServices.some((s) => s.gpu)
      try {
        const output = execSync("docker info --format '{{json .Runtimes}}'", {
          encoding: 'utf-8',
          timeout: 5000,
        })
        const hasNvidia = output.toLowerCase().includes('nvidia')
        if (hasNvidia) {
          checks.push({ name: 'NVIDIA Runtime', status: 'pass', message: 'NVIDIA container runtime detected' })
        } else if (gpuServicesEnabled) {
          checks.push({
            name: 'NVIDIA Runtime',
            status: 'warn',
            message: 'NVIDIA runtime not found. GPU services may not work.',
            details: 'Install the NVIDIA Container Toolkit for GPU acceleration',
          })
        }
      } catch {
        if (gpuServicesEnabled) {
          checks.push({
            name: 'NVIDIA Runtime',
            status: 'warn',
            message: 'Could not check for NVIDIA runtime. GPU services may not work.',
          })
        }
      }
    }

    const canProceed = !checks.some((c) => c.status === 'fail')
    const result: PreflightResult = { checks, canProceed }
    return reply.send(result)
  })

  /**
   * Detect hardware: GPU, RAM, platform.
   * Wrapped in try/catch so the endpoint never throws.
   */
  app.get('/hardware', async (_request, reply) => {
    try {
      const plat = platform()
      const archName = arch()
      const totalMemoryGb = Math.round(totalmem() / (1024 * 1024 * 1024))

      let gpuName: string | null = null
      let gpuVramMb: number | null = null
      const recommendedBackends: string[] = []
      let recommendedBackend = 'gguf'

      if (plat === 'darwin') {
        // macOS: check for Apple Silicon
        try {
          const output = execSync('system_profiler SPDisplaysDataType -json', {
            encoding: 'utf-8',
            timeout: 10_000,
          })
          const data = JSON.parse(output)
          const gpu = data?.SPDisplaysDataType?.[0]
          if (gpu) {
            gpuName = gpu.sppci_model ?? 'Apple Silicon GPU'
            gpuVramMb = totalMemoryGb * 1024 // Unified memory
          }
        } catch {
          // Fallback
        }

        if (archName === 'arm64') {
          recommendedBackends.push('gguf', 'mlx')
          recommendedBackend = 'gguf'
        } else {
          recommendedBackends.push('gguf')
        }
      } else if (plat === 'linux') {
        // Linux: check for NVIDIA GPU(s)
        try {
          const output = execSync(
            'nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits',
            { encoding: 'utf-8', timeout: 10_000 },
          )
          const lines = output.trim().split('\n').filter(Boolean)
          let totalVram = 0
          const gpuNames: string[] = []
          for (const line of lines) {
            const parts = line.split(', ')
            if (parts.length >= 2) {
              gpuNames.push(parts[0].trim())
              totalVram += parseInt(parts[1], 10)
            }
          }
          if (gpuNames.length > 0) {
            gpuName = gpuNames.length === 1
              ? gpuNames[0]
              : `${gpuNames.length}x ${gpuNames[0]}`
            gpuVramMb = totalVram
          }
        } catch {
          // No NVIDIA GPU
        }

        if (gpuName) {
          recommendedBackends.push('gguf', 'vllm')
          recommendedBackend = 'gguf'
        } else {
          recommendedBackends.push('gguf')
        }
      }

      // No GPU detected on any platform — offer remote as fallback
      if (!gpuName && recommendedBackends.length === 0) {
        recommendedBackends.push('remote')
        recommendedBackend = 'remote'
      }

      // ARM without GPU = suggest remote-llm
      const isArm = archName === 'arm64' || archName === 'aarch64'
      if (isArm && plat === 'linux' && !gpuName) {
        recommendedBackend = 'remote'
      }

      const info: HardwareInfo = {
        platform: plat === 'darwin' ? 'darwin' : 'linux',
        arch: archName,
        totalMemoryGb,
        gpuName,
        gpuVramMb,
        recommendedBackends,
        recommendedBackend,
      }

      return reply.send(info)
    } catch (err) {
      // Graceful fallback — never throw from hardware detection
      console.error('[install] Hardware detection failed:', err)
      const fallback: HardwareInfo = {
        platform: platform() === 'darwin' ? 'darwin' : 'linux',
        arch: arch(),
        totalMemoryGb: Math.round(totalmem() / (1024 * 1024 * 1024)),
        gpuName: null,
        gpuVramMb: null,
        recommendedBackends: ['remote'],
        recommendedBackend: 'remote',
      }
      return reply.send(fallback)
    }
  })

  /**
   * Generate compose, env, and init-db files.
   */
  app.post<{ Body: WizardState }>('/generate', async (request, reply) => {
    const state = request.body as WizardState
    const composePath = getComposePath()

    // Generate secrets if not provided
    if (!state.secrets || Object.keys(state.secrets).length === 0) {
      state.secrets = generateAllSecrets()
    }

    const enabledServices = getAllEnabledServices(state, registry)
    const primaryDb = registry.infrastructure
      .find((i) => i.id === 'postgres')
      ?.envVars.find((e) => e.name === 'POSTGRES_DB')?.default ?? 'jarvis_config'

    const compose = generateCompose(state, registry)
    const env = generateEnv(state, registry)
    const initDb = generateInitDbScript(enabledServices, primaryDb)

    // Write files
    mkdirSync(composePath, { recursive: true })
    // Create .models dir before Docker does, so it's owned by the user (not root)
    mkdirSync(join(composePath, '.models'), { recursive: true })
    writeFileSync(join(composePath, 'docker-compose.yml'), compose)
    writeFileSync(join(composePath, '.env'), env)
    writeFileSync(join(composePath, 'init-db.sh'), initDb)
    chmodSync(join(composePath, 'init-db.sh'), 0o755)

    return reply.send({
      ok: true,
      composePath,
      files: ['docker-compose.yml', '.env', 'init-db.sh'],
      serviceCount: enabledServices.length,
    })
  })

  /**
   * SSE: docker compose pull
   */
  app.get('/pull', async (request, reply) => {
    const composePath = getComposePath()
    const composeFile = join(composePath, 'docker-compose.yml')

    if (!existsSync(composeFile)) {
      return reply.code(400).send({ error: 'Compose file not found. Run /generate first.' })
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const child = spawn('docker', ['compose', '-f', composeFile, 'pull'], {
      cwd: composePath,
      env: { ...process.env, ...loadEnvFile(composePath) },
    })

    child.stdout.on('data', (chunk: Buffer) => {
      reply.raw.write(`data: ${JSON.stringify({ stream: 'stdout', text: chunk.toString() })}\n\n`)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      reply.raw.write(`data: ${JSON.stringify({ stream: 'stderr', text: chunk.toString() })}\n\n`)
    })

    request.raw.on('close', () => {
      child.kill()
    })

    child.on('close', (code) => {
      reply.raw.write(`data: ${JSON.stringify({ done: true, code })}\n\n`)
      reply.raw.end()
    })
  })

  /**
   * SSE: tiered startup — infra → config → auth → register → all services
   */
  app.get('/start', async (request, reply) => {
    const composePath = getComposePath()
    const composeFile = join(composePath, 'docker-compose.yml')

    if (!existsSync(composeFile)) {
      return reply.code(400).send({ error: 'Compose file not found. Run /generate first.' })
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const envVars = loadEnvFile(composePath)
    const adminToken = envVars.JARVIS_AUTH_ADMIN_TOKEN ?? ''
    const portOverrides = {} as Record<string, number>

    const emit = (data: Record<string, unknown>) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
      } catch {
        // Client disconnected
      }
    }

    try {
      // Check which services are already healthy before starting
      const alreadyHealthy = new Set<string>()
      const currentHealth = await pollServiceHealth(registry.services, portOverrides)
      for (const [id, status] of Object.entries(currentHealth)) {
        if (status.healthy) {
          alreadyHealthy.add(id)
          emit({ phase: 'preflight', message: `${id} already healthy, will skip` })
        }
      }

      const result = await tieredStartup(
        composeFile, composePath, registry.services, adminToken, portOverrides, emit, alreadyHealthy,
      )

      // Persist service URLs so the admin server can proxy to them
      if (result.success) {
        const authPort = envVars.AUTH_PORT ?? '7701'
        const configPort = envVars.CONFIG_SERVICE_PORT ?? '7700'
        const llmPort = envVars.LLM_PROXY_API_PORT ?? '7704'
        const ccPort = envVars.COMMAND_CENTER_PORT ?? '7703'

        const urls = {
          authUrl: `http://localhost:${authPort}`,
          configServiceUrl: `http://localhost:${configPort}`,
          llmProxyUrl: `http://localhost:${llmPort}`,
          commandCenterUrl: `http://localhost:${ccPort}`,
        }
        savePersistedConfig(urls)

        // Update in-memory config so subsequent requests work immediately
        Object.assign(app.config, urls)
      }

      // Emit service health results before closing
      if (result.serviceHealth) {
        emit({ phase: 'serviceHealth', serviceHealth: result.serviceHealth })
      }

      emit({ done: true, code: result.success ? 0 : 1, error: result.error, serviceHealth: result.serviceHealth })
    } catch (err) {
      emit({ done: true, code: 1, error: err instanceof Error ? err.message : String(err) })
    }

    reply.raw.end()
  })

  /**
   * Register services with config-service + auth, inject app keys.
   */
  app.post<{ Body: { portOverrides?: Record<string, number> } }>(
    '/register',
    async (request, reply) => {
      const composePath = getComposePath()
      const envFile = join(composePath, '.env')

      if (!existsSync(envFile)) {
        return reply.code(400).send({ error: 'Env file not found. Run /generate first.' })
      }

      const envVars = loadEnvFile(composePath)
      const adminToken = envVars.JARVIS_AUTH_ADMIN_TOKEN ?? ''
      const configPort = parseInt(envVars.CONFIG_SERVICE_PORT ?? '7700', 10)
      const configServiceUrl = `http://localhost:${configPort}`
      const portOverrides = (request.body as { portOverrides?: Record<string, number> })?.portOverrides ?? {}

      // Get all services from registry (except infrastructure)
      const services = registry.services.filter(
        (s) => s.category === 'core' || s.category === 'recommended',
      )

      const result = await registerServices(services, configServiceUrl, adminToken, portOverrides)

      return reply.send(result)
    },
  )

  /**
   * Poll all service health endpoints.
   */
  app.get('/health', async (_request, reply) => {
    const composePath = getComposePath()
    const envVars = existsSync(join(composePath, '.env'))
      ? loadEnvFile(composePath)
      : {}

    const services = registry.services
    const portOverrides: Record<string, number> = {}
    for (const svc of services) {
      const portVar = svc.id.replace(/^jarvis-/, '').replace(/-/g, '_').toUpperCase() + '_PORT'
      if (envVars[portVar]) {
        portOverrides[svc.id] = parseInt(envVars[portVar], 10)
      }
    }

    const status = await pollServiceHealth(services, portOverrides)
    return reply.send(status)
  })

  /**
   * macOS only: install llm-proxy natively via pip.
   */
  app.post('/llm-native', async (_request, reply) => {
    if (platform() !== 'darwin') {
      return reply.code(400).send({ error: 'Native LLM install is only available on macOS' })
    }

    // This would create a venv and pip install jarvis-llm-proxy-api
    // For now, return a stub indicating the feature exists
    return reply.send({
      ok: true,
      message: 'Native LLM proxy setup requires jarvis-llm-proxy-api to be published to PyPI',
    })
  })

  /**
   * Create superuser account via jarvis-auth.
   */
  app.post<{
    Body: { email: string; password: string; displayName: string }
  }>('/account', async (request, reply) => {
    const { email, password, displayName } = request.body as {
      email: string
      password: string
      displayName: string
    }

    if (!email || !password) {
      return reply.code(400).send({ error: 'Email and password are required' })
    }

    const composePath = getComposePath()
    const envVars = existsSync(join(composePath, '.env'))
      ? loadEnvFile(composePath)
      : {}
    const authPort = parseInt(envVars.AUTH_PORT ?? '7701', 10)
    const authUrl = `http://localhost:${authPort}`

    try {
      // Register user
      const registerRes = await fetch(`${authUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, display_name: displayName }),
        signal: AbortSignal.timeout(10_000),
      })

      if (!registerRes.ok) {
        const body = await registerRes.text()
        return reply.code(registerRes.status).send({ error: body })
      }

      // Promote to superuser via admin token
      const adminToken = envVars.JARVIS_AUTH_ADMIN_TOKEN ?? ''
      const promoteRes = await fetch(`${authUrl}/admin/users/promote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': adminToken,
        },
        body: JSON.stringify({ email }),
        signal: AbortSignal.timeout(10_000),
      })

      if (!promoteRes.ok) {
        const body = await promoteRes.text()
        return reply.code(promoteRes.status).send({
          error: `User created but promotion failed: ${body}`,
        })
      }

      return reply.send({ ok: true, email })
    } catch (err) {
      return reply.code(502).send({
        error: `Auth service unavailable: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  })

  /**
   * Get the service registry data.
   */
  app.get('/registry', async (_request, reply) => {
    return reply.send(registry)
  })

  /**
   * Get default enabled modules.
   */
  app.get('/defaults', async (_request, reply) => {
    const modules = getDefaultEnabledModules(registry)
    return reply.send({ enabledModules: modules })
  })
}

/**
 * Parse a .env file into a key-value object.
 */
function loadEnvFile(composePath: string): Record<string, string> {
  const envPath = join(composePath, '.env')
  if (!existsSync(envPath)) return {}

  const content = readFileSync(envPath, 'utf-8')
  const vars: Record<string, string> = {}

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex)
    const value = trimmed.slice(eqIndex + 1)
    vars[key] = value
  }

  return vars
}

/**
 * Check if a port is already in use by trying to listen on it.
 */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true)
      } else {
        resolve(false)
      }
    })
    server.once('listening', () => {
      server.close(() => resolve(false))
    })
    server.listen(port, '127.0.0.1')
  })
}
