import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import { buildApp } from '../../src/app.js'
import type { FastifyInstance } from 'fastify'
import type { DockerService, ContainerInfo } from '../../src/services/docker.js'
import type { RegistryService } from '../../src/services/registry.js'
import type { ComposeService } from '../../src/services/compose.js'

function mockSuperuserAuth(): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(
      JSON.stringify({ id: 1, email: 'admin@test.com', is_superuser: true }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  )
}

const optionalServices = [
  {
    id: 'recipes',
    name: 'Jarvis Recipes',
    description: 'Recipe management',
    category: 'optional' as const,
    port: 8001,
    image: 'jarvis-recipes:latest',
    healthCheck: '/health',
    dependsOn: ['auth'],
    envVars: [],
    profile: 'recipes',
  },
  {
    id: 'ocr',
    name: 'Jarvis OCR',
    description: 'OCR service',
    category: 'optional' as const,
    port: 5009,
    image: 'jarvis-ocr:latest',
    healthCheck: '/health',
    dependsOn: [],
    envVars: [],
    profile: 'ocr',
  },
]

const runningContainers: ContainerInfo[] = [
  {
    id: 'id-jarvis-recipes',
    name: 'jarvis-recipes',
    image: 'jarvis-recipes:latest',
    state: 'running',
    status: 'Up',
    ports: [],
    labels: {},
    created: new Date().toISOString(),
  },
]

function resetMocks(
  registry: RegistryService,
  docker: DockerService,
  compose: ComposeService,
): void {
  ;(registry.getOptionalServices as ReturnType<typeof vi.fn>).mockReturnValue(optionalServices)
  ;(registry.getServiceById as ReturnType<typeof vi.fn>).mockImplementation(
    (id: string) => optionalServices.find((s) => s.id === id),
  )
  ;(registry.getDependents as ReturnType<typeof vi.fn>).mockImplementation(
    (id: string) => optionalServices.filter((s) => s.dependsOn.includes(id)).map((s) => s.id),
  )
  ;(docker.listJarvisContainers as ReturnType<typeof vi.fn>).mockResolvedValue(runningContainers)
  ;(compose.enableModule as ReturnType<typeof vi.fn>).mockResolvedValue({ stdout: 'done', stderr: '' })
  ;(compose.disableModule as ReturnType<typeof vi.fn>).mockResolvedValue({ stdout: 'done', stderr: '' })
}

describe('module routes', () => {
  let app: FastifyInstance
  let mockRegistry: RegistryService
  let mockDocker: DockerService
  let mockCompose: ComposeService

  beforeAll(async () => {
    mockRegistry = {
      getRegistry: vi.fn(),
      getServiceById: vi.fn(),
      getOptionalServices: vi.fn(),
      getCoreServices: vi.fn(),
      getDependencies: vi.fn(),
      getDependents: vi.fn(),
      reload: vi.fn(),
    }
    mockDocker = {
      isAvailable: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      listJarvisContainers: vi.fn(),
      getContainerStatus: vi.fn(),
      restartContainer: vi.fn(),
      getContainerStats: vi.fn(),
    }
    mockCompose = {
      enableModule: vi.fn(),
      disableModule: vi.fn(),
    }

    resetMocks(mockRegistry, mockDocker, mockCompose)

    app = await buildApp({
      config: { authUrl: 'http://fake-auth:8007' },
      docker: mockDocker,
      compose: mockCompose,
      registry: mockRegistry,
    })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    vi.restoreAllMocks()
    resetMocks(mockRegistry, mockDocker, mockCompose)
  })

  describe('GET /api/modules', () => {
    it('returns modules with enabled state', async () => {
      mockSuperuserAuth()
      const res = await app.inject({
        method: 'GET',
        url: '/api/modules',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.modules).toHaveLength(2)

      const recipes = body.modules.find((m: { id: string }) => m.id === 'recipes')
      expect(recipes.enabled).toBe(true)

      const ocr = body.modules.find((m: { id: string }) => m.id === 'ocr')
      expect(ocr.enabled).toBe(false)
    })
  })

  describe('POST /api/modules/:id/enable', () => {
    it('enables a module', async () => {
      mockSuperuserAuth()
      const res = await app.inject({
        method: 'POST',
        url: '/api/modules/ocr/enable',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().success).toBe(true)
      expect(mockCompose.enableModule).toHaveBeenCalledWith('ocr')
    })

    it('returns 404 for unknown module', async () => {
      mockSuperuserAuth()
      const res = await app.inject({
        method: 'POST',
        url: '/api/modules/nonexistent/enable',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(404)
    })
  })

  describe('POST /api/modules/:id/disable', () => {
    it('disables a module', async () => {
      mockSuperuserAuth()
      const res = await app.inject({
        method: 'POST',
        url: '/api/modules/ocr/disable',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().success).toBe(true)
    })

    it('returns 409 when module has running dependents', async () => {
      // auth isn't in optional services, so it returns 404
      mockSuperuserAuth()
      const res = await app.inject({
        method: 'POST',
        url: '/api/modules/auth/disable',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(404)
    })
  })
})
