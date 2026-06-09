import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import { buildApp } from '../../src/app.js'
import type { FastifyInstance } from 'fastify'
import { mockSuperuserAuth, mockFetchJson } from '../helpers.js'

describe('admin routes (cross-household views)', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      config: {
        authUrl: 'http://fake-auth:7701',
        configServiceUrl: 'http://fake-config:7700',
      },
    })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('requires auth on /api/admin/households', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/households' })
    expect(res.statusCode).toBe(401)
  })

  it('requires auth on /api/admin/nodes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/nodes' })
    expect(res.statusCode).toBe(401)
  })

  it('proxies households to /superuser/households on jarvis-auth', async () => {
    const households = [
      { id: 'h1', name: 'Alpha House', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      { id: 'h2', name: 'Beta House', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' },
    ]
    mockSuperuserAuth()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockFetchJson(households))

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/households',
      headers: { authorization: 'Bearer valid-token' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(households)

    const calls = vi.mocked(fetch).mock.calls
    const proxied = calls.find((c) => String(c[0]).includes('/superuser/households'))
    expect(proxied).toBeDefined()
    expect(String(proxied![0])).toBe('http://fake-auth:7701/superuser/households')
    const headers = (proxied![1] as RequestInit).headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer valid-token')
  })

  it('proxies nodes to /superuser/nodes on jarvis-auth', async () => {
    const nodes = [
      { node_id: 'kitchen-pi', name: 'Kitchen', household_id: 'h1', is_active: true, services: [] },
    ]
    mockSuperuserAuth()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockFetchJson(nodes))

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/nodes',
      headers: { authorization: 'Bearer valid-token' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(nodes)
  })

  it('forwards upstream error status', async () => {
    mockSuperuserAuth()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockFetchJson({ detail: 'Superuser access required' }, 403),
    )

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/households',
      headers: { authorization: 'Bearer valid-token' },
    })

    expect(res.statusCode).toBe(403)
  })
})
