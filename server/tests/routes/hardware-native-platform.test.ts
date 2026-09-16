/**
 * The hardware endpoint must report the platform it is actually running on.
 *
 * No mocks here on purpose. Every other test in this area simulates a host with
 * HOST_OS, which is how two wrong labels reached a user: Windows was reported as
 * macOS (Docker Desktop identifies itself identically on both), and after that
 * was fixed it was reported as Linux (the value was collapsed to darwin|linux on
 * its way to the client). Both were invisible to a suite that only ever ran on
 * Linux, where "collapsed to linux" and "correct" are the same string.
 *
 * So this asserts against process.platform and runs on every OS in CI. On Linux
 * it is nearly a tautology; on the windows-latest job it is the whole point.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { resetHostPlatformCache } from '../../src/services/host-platform.js'
import { resetContainerisedCache } from '../../src/services/runtime-env.js'

describe('GET /api/install/hardware on the real host', () => {
  let app: FastifyInstance
  const origHostOs = process.env.HOST_OS

  beforeEach(async () => {
    // Explicitly unset: an override would defeat the point of this file.
    delete process.env.HOST_OS
    delete process.env.JARVIS_IN_CONTAINER
    resetHostPlatformCache()
    resetContainerisedCache()
    app = await buildApp({ config: { authUrl: 'http://fake-auth:7701' } })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    if (origHostOs !== undefined) process.env.HOST_OS = origHostOs
    resetHostPlatformCache()
    resetContainerisedCache()
  })

  it('reports this machine, not a flattened stand-in', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/install/hardware' })

    expect(res.statusCode).toBe(200)
    expect(res.json().platform).toBe(process.platform)
  })

  it('never claims macOS unless it is macOS', async () => {
    // The first bug, stated as an invariant: Docker Desktop being installed
    // must not make a non-Mac look like a Mac.
    const body = (await app.inject({ method: 'GET', url: '/api/install/hardware' })).json()

    if (process.platform !== 'darwin') {
      expect(body.platform).not.toBe('darwin')
    }
  })

  it('never claims Linux unless it is Linux', async () => {
    // The second bug: win32 was being mapped onto 'linux' for the client.
    const body = (await app.inject({ method: 'GET', url: '/api/install/hardware' })).json()

    if (process.platform !== 'linux') {
      expect(body.platform).not.toBe('linux')
    }
  })

  it('still reports memory and a backend recommendation on any platform', async () => {
    // A platform with no branch of its own used to fall through with nothing
    // usable, which is how Windows ended up being told to use a remote LLM.
    const body = (await app.inject({ method: 'GET', url: '/api/install/hardware' })).json()

    expect(body.totalMemoryGb).toBeGreaterThan(0)
    expect(Array.isArray(body.recommendedBackends)).toBe(true)
    expect(body.recommendedBackends.length).toBeGreaterThan(0)
    expect(typeof body.recommendedBackend).toBe('string')
  })
})
