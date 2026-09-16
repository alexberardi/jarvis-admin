/**
 * A native admin process must trust its own OS.
 *
 * getHostPlatform() asks the Docker daemon what the host is, because a
 * CONTAINERISED admin cannot see past its own /. But Docker Desktop reports
 * "Docker Desktop" on Windows exactly as it does on macOS, so consulting it
 * from a native process gets the answer wrong in the one case where the process
 * already knew it.
 *
 * A user installing on Windows with the admin .exe hit both consequences at
 * once: the wizard's hardware screen told them they were on a Mac, and because
 * the hardware probe branches on platform, it ran `system_profiler` instead of
 * `nvidia-smi` -- so their RTX 3050 was never looked for.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// vi.mock with a hoisted factory, not vi.spyOn: an ESM module namespace is not
// configurable, so spying on `execSync` throws "Cannot redefine property". The
// existing host-platform test worked around this by not mocking at all and only
// asserting the value was not 'banana'.
const execSyncMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execSync: execSyncMock }))

import { getHostPlatform, resetHostPlatformCache } from '../../src/services/host-platform.js'
import { resetContainerisedCache } from '../../src/services/runtime-env.js'

const ORIG_HOST_OS = process.env.HOST_OS

describe('getHostPlatform when admin runs natively', () => {
  beforeEach(() => {
    delete process.env.HOST_OS
    resetHostPlatformCache()
    resetContainerisedCache()
  })

  afterEach(() => {
    if (ORIG_HOST_OS === undefined) delete process.env.HOST_OS
    else process.env.HOST_OS = ORIG_HOST_OS
    delete process.env.JARVIS_IN_CONTAINER
    resetHostPlatformCache()
    resetContainerisedCache()
    execSyncMock.mockReset()
    vi.restoreAllMocks()
  })

  it('does not ask docker at all when it is not in a container', () => {
    process.env.JARVIS_IN_CONTAINER = 'false'
    resetContainerisedCache()
    const plat = getHostPlatform()

    // process.platform is authoritative here; the daemon is not consulted.
    expect(plat).toBe(process.platform)
    expect(execSyncMock).not.toHaveBeenCalled()
  })

  it('still asks docker when it IS in a container, where it cannot see the host', () => {
    process.env.JARVIS_IN_CONTAINER = 'true'
    resetContainerisedCache()
    execSyncMock.mockReturnValue('Docker Desktop')

    // Containerised + Docker Desktop is the one case the heuristic is for.
    expect(getHostPlatform()).toBe('darwin')
  })

  it('HOST_OS still wins over everything', () => {
    process.env.JARVIS_IN_CONTAINER = 'false'
    process.env.HOST_OS = 'win32'
    resetContainerisedCache()
    resetHostPlatformCache()

    expect(getHostPlatform()).toBe('win32')
  })

  it('a native run is never mislabelled darwin just because Docker Desktop is installed', () => {
    // The regression, stated directly: on Windows this returned 'darwin'.
    process.env.JARVIS_IN_CONTAINER = 'false'
    resetContainerisedCache()
    execSyncMock.mockReturnValue('Docker Desktop')

    expect(getHostPlatform()).toBe(process.platform)
    if (process.platform !== 'darwin') {
      expect(getHostPlatform()).not.toBe('darwin')
    }
  })
})
