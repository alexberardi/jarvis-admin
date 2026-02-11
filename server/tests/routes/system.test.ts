import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import { buildApp } from '../../src/app.js'
import type { FastifyInstance } from 'fastify'

function mockSuperuserAuth(): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(
      JSON.stringify({ id: 1, email: 'admin@test.com', is_superuser: true }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  )
}

describe('system routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      config: { authUrl: 'http://fake-auth:8007' },
    })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('GET /api/system/info', () => {
    it('returns system information', async () => {
      mockSuperuserAuth()
      const res = await app.inject({
        method: 'GET',
        url: '/api/system/info',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.hostname).toBeDefined()
      expect(body.platform).toBeDefined()
      expect(body.cpuCount).toBeGreaterThan(0)
      expect(body.totalMemoryMb).toBeGreaterThan(0)
      expect(body.version).toBe('0.1.0')
      expect(body.uptime).toBeGreaterThan(0)
    })

    it('requires auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/system/info',
      })

      expect(res.statusCode).toBe(401)
    })
  })
})
