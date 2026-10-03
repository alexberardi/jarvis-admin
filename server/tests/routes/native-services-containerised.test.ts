/**
 * A containerised admin must not claim to manage the host's launchd agents.
 *
 * getHostPlatform() reports darwin on Docker Desktop BY DESIGN, so the
 * native-services routes used to pass their only guard while running inside the
 * container: homedir() is /root there and launchctl does not exist, so
 * `installed` came back false for agents that were installed AND running on the
 * Mac, and the page told the user to "Re-run install wizard to enable" services
 * that were already up. Observed 2026-10-02 on a CLI-started stack, where admin
 * runs in Docker while whisper/ocr/llm-proxy run as real agents on the host.
 *
 * Both conditions are simulated, because CI runs on Linux where the honest
 * answer is "not macOS" and the regression would be invisible.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { resetHostPlatformCache } from '../../src/services/host-platform.js'
import { resetContainerisedCache } from '../../src/services/runtime-env.js'

describe('native-services on a containerised admin', () => {
  let app: FastifyInstance
  const origHostOs = process.env.HOST_OS
  const origInContainer = process.env.JARVIS_IN_CONTAINER

  async function boot(inContainer: boolean): Promise<void> {
    process.env.HOST_OS = 'darwin'
    process.env.JARVIS_IN_CONTAINER = inContainer ? 'true' : 'false'
    resetHostPlatformCache()
    resetContainerisedCache()
    app = await buildApp({ config: { authUrl: 'http://fake-auth:7701' } })
    await app.ready()
  }

  beforeEach(() => {
    delete process.env.HOST_OS
    delete process.env.JARVIS_IN_CONTAINER
  })

  afterEach(async () => {
    if (app) await app.close()
    if (origHostOs !== undefined) process.env.HOST_OS = origHostOs
    else delete process.env.HOST_OS
    if (origInContainer !== undefined) process.env.JARVIS_IN_CONTAINER = origInContainer
    else delete process.env.JARVIS_IN_CONTAINER
    resetHostPlatformCache()
    resetContainerisedCache()
  })

  it('reports unsupported with a reason instead of a list of "not installed" services', async () => {
    await boot(true)

    const res = await app.inject({ method: 'GET', url: '/api/native-services' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.supported).toBe(false)
    expect(body.services).toEqual([])
    // The page renders this verbatim, so it has to say what to do about it.
    expect(String(body.reason)).toMatch(/container/i)
  })

  it('refuses to install an agent it could only write inside the container', async () => {
    await boot(true)

    const res = await app.inject({
      method: 'GET',
      url: '/api/native-services/jarvis-whisper-api/install',
    })

    expect(res.statusCode).toBe(409)
    expect(String(res.json().error)).toMatch(/container/i)
  })

  it('still supports native management when admin is NOT containerised', async () => {
    await boot(false)

    const res = await app.inject({ method: 'GET', url: '/api/native-services' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.supported).toBe(true)
    expect(body.reason).toBeUndefined()
    expect(Array.isArray(body.services)).toBe(true)
  })
})
