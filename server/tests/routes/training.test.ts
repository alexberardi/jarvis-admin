import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import { buildApp } from '../../src/app.js'
import type { FastifyInstance } from 'fastify'
import { mockSuperuserAuth, mockFetchJson } from '../helpers.js'

describe('training routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      config: {
        authUrl: 'http://fake-auth:7701',
        llmProxyUrl: 'http://fake-llm:7704',
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

  it('requires auth for all endpoints', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/training/status',
    })

    expect(res.statusCode).toBe(401)
  })

  describe('GET /api/training/status', () => {
    it('proxies to llm-proxy pipeline status', async () => {
      const statusData = { status: 'idle', jobs: [] }

      mockSuperuserAuth()
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockFetchJson(statusData),
      )

      const res = await app.inject({
        method: 'GET',
        url: '/api/training/status',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual(statusData)

      const calls = vi.mocked(fetch).mock.calls
      const pipelineCall = calls.find((c) =>
        String(c[0]).includes('/v1/pipeline/status'),
      )
      expect(pipelineCall).toBeDefined()
    })
  })

  describe('POST /api/training/build', () => {
    it('proxies build request to llm-proxy', async () => {
      const buildResponse = { job_id: 'job-123', status: 'queued' }

      mockSuperuserAuth()
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockFetchJson(buildResponse),
      )

      const res = await app.inject({
        method: 'POST',
        url: '/api/training/build',
        headers: { authorization: 'Bearer valid-token' },
        payload: { model: 'base-model', config: {} },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual(buildResponse)
    })
  })

  describe('POST /api/training/cancel', () => {
    it('proxies cancel request to llm-proxy', async () => {
      mockSuperuserAuth()
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockFetchJson({ cancelled: true }),
      )

      const res = await app.inject({
        method: 'POST',
        url: '/api/training/cancel',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().cancelled).toBe(true)
    })
  })

  describe('GET /api/training/artifacts', () => {
    it('proxies artifacts request to llm-proxy', async () => {
      const artifacts = { adapters: ['adapter-v1'] }

      mockSuperuserAuth()
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockFetchJson(artifacts),
      )

      const res = await app.inject({
        method: 'GET',
        url: '/api/training/artifacts',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual(artifacts)
    })
  })

  describe('GET /api/training/logs', () => {
    it('returns 502 when llm-proxy is unreachable', async () => {
      mockSuperuserAuth()
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
        new TypeError('fetch failed'),
      )

      const res = await app.inject({
        method: 'GET',
        url: '/api/training/logs',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(502)
    })

    it('returns upstream status when response is not ok', async () => {
      mockSuperuserAuth()
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(null, { status: 503 }),
      )

      const res = await app.inject({
        method: 'GET',
        url: '/api/training/logs',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(503)
    })
  })
})
