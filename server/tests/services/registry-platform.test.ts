/**
 * A service that cannot run on this host must not be offered.
 *
 * jarvis-osx-api is the macOS iMessage/Contacts bridge: it needs host TCC
 * grants, a GUI session and a launchd job. That was expressed only in its
 * description -- "macOS native only, runs as a LaunchAgent, never in Docker" --
 * which is prose the wizard cannot act on. A Windows user was shown it in the
 * Optional list, enabled it, and the install step tried to run the launchd
 * deploy script through bash:
 *
 *     Cloning into 'C:\Users\dumbf\.jarvis\native\jarvis-osx-api'...
 *     <3>WSL ERROR: CreateProcessCommon:818: execvpe(/bin/bash) failed:
 *       No such file or directory
 *
 * `nativeOnly` already said HOW it runs; `platforms` now says WHERE.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { registryForHost, runsOn } from '../../src/services/registry-platform.js'
import { parseRegistry } from '../../src/services/generators/service-registry.js'
import type { ServiceRegistry } from '../../src/types/service-registry.js'

function bundled(): ServiceRegistry {
  return parseRegistry(
    JSON.parse(
      readFileSync(join(import.meta.dirname, '..', '..', 'src', 'data', 'service-registry.json'), 'utf-8'),
    ),
  )
}

describe('runsOn', () => {
  it('treats an absent list as "anywhere"', () => {
    expect(runsOn(undefined, 'win32')).toBe(true)
    expect(runsOn(undefined, 'darwin')).toBe(true)
    expect(runsOn(undefined, 'linux')).toBe(true)
  })

  it('treats an empty list as "anywhere" rather than "nowhere"', () => {
    // A service that runs nowhere is a packaging mistake, not a thing to model;
    // failing open keeps a stray `"platforms": []` from hiding a core service.
    expect(runsOn([], 'win32')).toBe(true)
  })

  it('honours an explicit list', () => {
    expect(runsOn(['darwin'], 'darwin')).toBe(true)
    expect(runsOn(['darwin'], 'win32')).toBe(false)
    expect(runsOn(['darwin'], 'linux')).toBe(false)
    expect(runsOn(['linux', 'win32'], 'win32')).toBe(true)
  })
})

describe('registryForHost with the real bundled registry', () => {
  it('offers the macOS bridge on macOS', () => {
    const ids = registryForHost(bundled(), 'darwin').services.map((s) => s.id)
    expect(ids).toContain('jarvis-osx-api')
  })

  it('does NOT offer it on Windows — the case a real user hit', () => {
    const ids = registryForHost(bundled(), 'win32').services.map((s) => s.id)
    expect(ids).not.toContain('jarvis-osx-api')
  })

  it('does NOT offer it on Linux either', () => {
    const ids = registryForHost(bundled(), 'linux').services.map((s) => s.id)
    expect(ids).not.toContain('jarvis-osx-api')
  })

  it('keeps every other service on every platform', () => {
    const all = bundled().services.map((s) => s.id)
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      const kept = registryForHost(bundled(), platform).services.map((s) => s.id)
      const dropped = all.filter((id) => !kept.includes(id))
      // Only platform-restricted services may ever be dropped.
      for (const id of dropped) {
        const svc = bundled().services.find((s) => s.id === id)
        expect(svc?.platforms, `${id} was dropped without declaring platforms`).toBeTruthy()
      }
    }
  })

  it('leaves the rest of the registry untouched', () => {
    const filtered = registryForHost(bundled(), 'win32')
    expect(filtered.infrastructure).toEqual(bundled().infrastructure)
  })

  it('the macOS bridge declares its platform in DATA, not just prose', () => {
    // The whole point: the constraint has to be machine-readable.
    const svc = bundled().services.find((s) => s.id === 'jarvis-osx-api')
    expect(svc, 'jarvis-osx-api missing from the registry').toBeTruthy()
    expect(svc?.platforms).toEqual(['darwin'])
  })
})
