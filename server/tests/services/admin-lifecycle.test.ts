import { describe, it, expect } from 'vitest'
import {
  shouldSelfTerminateAfterInstall,
  shouldRedirectWhenInstalled,
} from '../../src/services/admin-lifecycle.js'

describe('admin-lifecycle: post-install self-termination', () => {
  it('does NOT self-terminate on macOS — the native binary is the permanent admin', () => {
    // Regression guard: the native macOS admin must stay alive after install so
    // the dashboard + native-services (llm-proxy/whisper/tts) step keep a
    // backend. Killing it is what made "all native pulls fail".
    expect(shouldSelfTerminateAfterInstall('darwin')).toBe(false)
  })

  it('self-terminates on Linux — the containerized admin takes over the port', () => {
    expect(shouldSelfTerminateAfterInstall('linux')).toBe(true)
  })

  it('does NOT self-terminate on Windows — its admin container is not proven', () => {
    // Was `!== darwin`, which only looked right while Docker Desktop made
    // Windows report darwin: the installer stayed alive by accident. Now that a
    // native process reports win32 honestly, exiting would strand it, because a
    // real Windows install had "jarvis-admin failed health check after 60s" —
    // the native binary was the only dashboard there was.
    expect(shouldSelfTerminateAfterInstall('win32')).toBe(false)
  })
})

describe('admin-lifecycle: serve-vs-redirect when already installed', () => {
  it('serves the full app on macOS (no container to redirect to)', () => {
    expect(shouldRedirectWhenInstalled('darwin')).toBe(false)
  })

  it('redirects to the containerized dashboard on Linux', () => {
    expect(shouldRedirectWhenInstalled('linux')).toBe(true)
  })

  it('does NOT redirect on Windows — that container may not be there', () => {
    // Same lesson: a redirect to a container that failed its health check is a
    // dead port, while serving the app from this binary works either way.
    expect(shouldRedirectWhenInstalled('win32')).toBe(false)
  })

  it('only linux redirects — every other platform serves the app itself', () => {
    // The rule is "is there a container serving this port", not "is this
    // darwin". Linux is the only platform where that is established.
    expect(shouldRedirectWhenInstalled('linux')).toBe(true)
    expect(shouldRedirectWhenInstalled('freebsd')).toBe(false)
  })
})
