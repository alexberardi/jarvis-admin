/**
 * A Windows host must have its NVIDIA GPU found.
 *
 * The hardware probe branched on darwin and linux only, so a Windows host fell
 * through with gpuType 'none' and got recommended a REMOTE llm -- and before
 * the host-platform fix it never reached even that, because Docker Desktop made
 * Windows look like macOS and the probe ran `system_profiler`.
 *
 * A user reported exactly this on a fresh install: "it keeps reading my
 * hardware as macos... it didn't have my GPU either". Their card was an
 * RTX 3050.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const execSyncMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({
  execSync: execSyncMock,
  execFile: vi.fn(),
}))

import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { resetHostPlatformCache } from '../../src/services/host-platform.js'
import { resetContainerisedCache } from '../../src/services/runtime-env.js'

const NVIDIA_SMI_3050 = 'NVIDIA GeForce RTX 3050 Laptop GPU, 4096\n'

describe('GET /api/install/hardware on Windows', () => {
  let app: FastifyInstance
  const origHostOs = process.env.HOST_OS

  beforeEach(async () => {
    process.env.HOST_OS = 'win32'
    resetHostPlatformCache()
    resetContainerisedCache()
    execSyncMock.mockReset()
    app = await buildApp({ config: { authUrl: 'http://fake-auth:7701' } })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    if (origHostOs === undefined) delete process.env.HOST_OS
    else process.env.HOST_OS = origHostOs
    resetHostPlatformCache()
    resetContainerisedCache()
    vi.restoreAllMocks()
  })

  it('finds the card via nvidia-smi', async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (String(cmd).includes('nvidia-smi')) return NVIDIA_SMI_3050
      throw new Error(`not available on windows: ${cmd}`)
    })

    const res = await app.inject({ method: 'GET', url: '/api/install/hardware' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.gpuType).toBe('nvidia')
    expect(body.gpuName).toContain('RTX 3050')
    expect(body.gpuVramMb).toBe(4096)
  })

  it('does not recommend a remote LLM just because the host is Windows', async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (String(cmd).includes('nvidia-smi')) return NVIDIA_SMI_3050
      throw new Error('unavailable')
    })

    const body = (await app.inject({ method: 'GET', url: '/api/install/hardware' })).json()

    expect(body.recommendedBackend).toBe('gguf')
    expect(body.recommendedBackends).toContain('gguf')
  })

  it('never probes with system_profiler on Windows', async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (String(cmd).includes('nvidia-smi')) return NVIDIA_SMI_3050
      throw new Error('unavailable')
    })

    await app.inject({ method: 'GET', url: '/api/install/hardware' })

    const commands = execSyncMock.mock.calls.map((c) => String(c[0]))
    expect(commands.some((c) => c.includes('system_profiler'))).toBe(false)
    expect(commands.some((c) => c.includes('nvidia-smi'))).toBe(true)
  })

  it('reports "not a Mac" so the wizard does not offer native macOS services', async () => {
    execSyncMock.mockImplementation(() => { throw new Error('no gpu') })

    const body = (await app.inject({ method: 'GET', url: '/api/install/hardware' })).json()

    // The field is a two-way gate for the Mac-only native path; Windows is
    // correctly on the non-Mac side of it.
    expect(body.platform).toBe('linux')
  })

  it('a Windows host with no NVIDIA driver still gets a usable recommendation', async () => {
    execSyncMock.mockImplementation(() => { throw new Error('nvidia-smi not found') })

    const body = (await app.inject({ method: 'GET', url: '/api/install/hardware' })).json()

    expect(body.gpuType).toBe('none')
    expect(body.recommendedBackends.length).toBeGreaterThan(0)
  })
})
