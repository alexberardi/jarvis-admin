import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../../src/app.js'
import type { FastifyInstance } from 'fastify'
import type { DockerService, ContainerInfo } from '../../src/services/docker.js'
import type { RegistryService, ServiceRegistry } from '../../src/services/registry.js'
import { mockSuperuserAuth } from '../helpers.js'

const REGISTRY: ServiceRegistry = {
  version: '1',
  infrastructure: [],
  services: [
    {
      id: 'jarvis-phone-gateway',
      name: 'Phone Calls',
      description: 'AI phone-call gateway',
      category: 'optional',
      port: 7713,
      image: 'ghcr.io/alexberardi/jarvis-phone-gateway:latest',
      healthCheck: '/health',
      dependsOn: [],
      envVars: [
        {
          name: 'JARVIS_CONFIG_URL',
          description: 'Config service URL',
          required: false,
          default: 'http://jarvis-config-service:7700',
        },
        {
          name: 'TWILIO_ACCOUNT_SID',
          description: 'Twilio account SID',
          required: true,
          secret: true,
          default: '${TWILIO_ACCOUNT_SID:-}',
        },
        {
          name: 'TWILIO_AUTH_TOKEN',
          description: 'Twilio auth token',
          required: true,
          secret: true,
          default: '${TWILIO_AUTH_TOKEN:-}',
        },
        {
          name: 'TWILIO_FROM_NUMBER',
          description: 'Caller-ID number',
          required: true,
          default: '${TWILIO_FROM_NUMBER:-}',
        },
      ],
    },
    {
      id: 'jarvis-logs',
      name: 'Logs',
      description: 'no user-supplied vars',
      category: 'core',
      port: 7702,
      image: 'ghcr.io/alexberardi/jarvis-logs:latest',
      healthCheck: '/health',
      dependsOn: [],
      envVars: [
        {
          name: 'DATABASE_URL',
          description: 'generated',
          required: true,
          default: 'postgresql://x',
        },
      ],
    },
  ],
}

function createMockRegistry(): RegistryService {
  return {
    getRegistry: () => REGISTRY,
    getServiceById: (id: string) => REGISTRY.services.find((s) => s.id === id),
    getOptionalServices: () => REGISTRY.services.filter((s) => s.category === 'optional'),
    getCoreServices: () => REGISTRY.services.filter((s) => s.category === 'core'),
    getDependencies: () => [],
    getDependents: () => [],
    reload: () => undefined,
  }
}

function createMockDocker(containers: ContainerInfo[] = []): DockerService {
  return {
    isAvailable: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    listJarvisContainers: vi.fn<() => Promise<ContainerInfo[]>>().mockResolvedValue(containers),
    getContainerStatus: vi.fn().mockResolvedValue(null),
    restartContainer: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
    getContainerStats: vi.fn().mockResolvedValue(null),
  } as unknown as DockerService
}

const gatewayContainer: ContainerInfo = {
  id: 'gw-1',
  name: 'jarvis-phone-gateway',
  image: 'ghcr.io/alexberardi/jarvis-phone-gateway:latest',
  state: 'running',
  status: 'Up 1 hour',
  ports: [{ private: 7713, public: 7713 }],
  labels: {},
  created: '2026-01-01T00:00:00Z',
}

describe('service-env routes', () => {
  let app: FastifyInstance
  let composeDir: string

  const envPath = () => join(composeDir, '.env')

  beforeEach(async () => {
    composeDir = mkdtempSync(join(tmpdir(), 'svc-env-'))
    process.env.JARVIS_COMPOSE_PATH = composeDir
    app = await buildApp({
      docker: createMockDocker([gatewayContainer]),
      registry: createMockRegistry(),
    })
  })

  afterEach(async () => {
    await app.close()
    delete process.env.JARVIS_COMPOSE_PATH
    rmSync(composeDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  const seedEnv = (content: string) => writeFileSync(envPath(), content)

  describe('GET /api/service-env', () => {
    it('lists only services with user-supplied vars', async () => {
      seedEnv('TWILIO_ACCOUNT_SID=AC123\nTWILIO_FROM_NUMBER=+19082781811\nOTHER=x\n')
      mockSuperuserAuth()
      const res = await app.inject({ method: 'GET', url: '/api/service-env', headers: { authorization: 'Bearer t' } })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.services).toHaveLength(1)
      expect(body.services[0].service_id).toBe('jarvis-phone-gateway')
    })

    it('never returns secret values, only is_set', async () => {
      seedEnv('TWILIO_ACCOUNT_SID=AC-super-secret\nTWILIO_AUTH_TOKEN=\n')
      mockSuperuserAuth()
      const res = await app.inject({ method: 'GET', url: '/api/service-env', headers: { authorization: 'Bearer t' } })
      const raw = res.body
      expect(raw).not.toContain('AC-super-secret')
      const vars = res.json().services[0].vars
      const sid = vars.find((v: { name: string }) => v.name === 'TWILIO_ACCOUNT_SID')
      const token = vars.find((v: { name: string }) => v.name === 'TWILIO_AUTH_TOKEN')
      expect(sid.is_set).toBe(true)
      expect(sid.value).toBeNull()
      expect(token.is_set).toBe(false)
    })

    it('echoes non-secret user-supplied values and marks generated vars read-only', async () => {
      seedEnv('TWILIO_FROM_NUMBER=+19082781811\n')
      mockSuperuserAuth()
      const res = await app.inject({ method: 'GET', url: '/api/service-env', headers: { authorization: 'Bearer t' } })
      const vars = res.json().services[0].vars
      const from = vars.find((v: { name: string }) => v.name === 'TWILIO_FROM_NUMBER')
      expect(from.user_supplied).toBe(true)
      expect(from.value).toBe('+19082781811')
      const config = vars.find((v: { name: string }) => v.name === 'JARVIS_CONFIG_URL')
      expect(config.user_supplied).toBe(false)
      expect(config.default).toBe('http://jarvis-config-service:7700')
    })

    it('reports env_file_exists=false when nothing is installed', async () => {
      mockSuperuserAuth()
      const res = await app.inject({ method: 'GET', url: '/api/service-env', headers: { authorization: 'Bearer t' } })
      expect(res.json().services[0].env_file_exists).toBe(false)
    })
  })

  describe('PUT /api/service-env/:serviceId', () => {
    it('writes editable vars and preserves unrelated lines', async () => {
      seedEnv('# stack env\nPOSTGRES_PASSWORD=keepme\nTWILIO_ACCOUNT_SID=\n')
      mockSuperuserAuth()
      const res = await app.inject({
        method: 'PUT',
        url: '/api/service-env/jarvis-phone-gateway',
        headers: { authorization: 'Bearer t' },
        payload: {
          values: { TWILIO_ACCOUNT_SID: 'AC999', TWILIO_FROM_NUMBER: '+19082781811' },
        },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.success).toBe(true)
      expect(body.updated.sort()).toEqual(['TWILIO_ACCOUNT_SID', 'TWILIO_FROM_NUMBER'])
      expect(body.restart_required).toBe(true)
      expect(body.container_id).toBe('gw-1')
      const env = readFileSync(envPath(), 'utf-8')
      expect(env).toContain('POSTGRES_PASSWORD=keepme')
      expect(env).toContain('# stack env')
      expect(env).toContain('TWILIO_ACCOUNT_SID=AC999')
      expect(env).toContain('TWILIO_FROM_NUMBER=+19082781811')
    })

    it('rejects undeclared vars (allowlist), writing nothing', async () => {
      seedEnv('TWILIO_ACCOUNT_SID=\n')
      mockSuperuserAuth()
      const res = await app.inject({
        method: 'PUT',
        url: '/api/service-env/jarvis-phone-gateway',
        headers: { authorization: 'Bearer t' },
        payload: { values: { TWILIO_ACCOUNT_SID: 'AC1', EVIL_VAR: 'x' } },
      })
      expect(res.statusCode).toBe(400)
      expect(readFileSync(envPath(), 'utf-8')).not.toContain('AC1')
    })

    it('rejects generated (non-user-supplied) declared vars', async () => {
      seedEnv('TWILIO_ACCOUNT_SID=\n')
      mockSuperuserAuth()
      const res = await app.inject({
        method: 'PUT',
        url: '/api/service-env/jarvis-phone-gateway',
        headers: { authorization: 'Bearer t' },
        payload: { values: { JARVIS_CONFIG_URL: 'http://evil' } },
      })
      expect(res.statusCode).toBe(400)
    })

    it('rejects values containing newlines (env injection)', async () => {
      seedEnv('TWILIO_ACCOUNT_SID=\n')
      mockSuperuserAuth()
      const res = await app.inject({
        method: 'PUT',
        url: '/api/service-env/jarvis-phone-gateway',
        headers: { authorization: 'Bearer t' },
        payload: { values: { TWILIO_ACCOUNT_SID: 'AC1\nINJECTED=1' } },
      })
      expect(res.statusCode).toBe(400)
      expect(readFileSync(envPath(), 'utf-8')).not.toContain('INJECTED')
    })

    it('409s when no stack .env exists yet', async () => {
      mockSuperuserAuth()
      const res = await app.inject({
        method: 'PUT',
        url: '/api/service-env/jarvis-phone-gateway',
        headers: { authorization: 'Bearer t' },
        payload: { values: { TWILIO_ACCOUNT_SID: 'AC1' } },
      })
      expect(res.statusCode).toBe(409)
      expect(existsSync(envPath())).toBe(false)
    })

    it('404s for unknown services', async () => {
      seedEnv('X=1\n')
      mockSuperuserAuth()
      const res = await app.inject({
        method: 'PUT',
        url: '/api/service-env/nope',
        headers: { authorization: 'Bearer t' },
        payload: { values: { TWILIO_ACCOUNT_SID: 'AC1' } },
      })
      expect(res.statusCode).toBe(404)
    })

    it('audit log names vars but never values', async () => {
      seedEnv('TWILIO_ACCOUNT_SID=\n')
      const logSpy = vi.spyOn(app.log, 'info')
      mockSuperuserAuth()
      await app.inject({
        method: 'PUT',
        url: '/api/service-env/jarvis-phone-gateway',
        headers: { authorization: 'Bearer t' },
        payload: { values: { TWILIO_ACCOUNT_SID: 'AC-should-not-log' } },
      })
      const auditCalls = logSpy.mock.calls.filter(
        (c) => typeof c[1] === 'string' && c[1].includes('secrets editor'),
      )
      expect(auditCalls).toHaveLength(1)
      expect(JSON.stringify(auditCalls[0])).toContain('TWILIO_ACCOUNT_SID')
      expect(JSON.stringify(auditCalls[0])).not.toContain('AC-should-not-log')
    })

    it('restart_required=false when the container is not running', async () => {
      await app.close()
      app = await buildApp({
        docker: createMockDocker([{ ...gatewayContainer, state: 'exited' }]),
        registry: createMockRegistry(),
      })
      seedEnv('TWILIO_ACCOUNT_SID=\n')
      mockSuperuserAuth()
      const res = await app.inject({
        method: 'PUT',
        url: '/api/service-env/jarvis-phone-gateway',
        headers: { authorization: 'Bearer t' },
        payload: { values: { TWILIO_ACCOUNT_SID: 'AC1' } },
      })
      expect(res.json().restart_required).toBe(false)
    })
  })
})
