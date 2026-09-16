import { existsSync } from 'node:fs'

/**
 * Is this admin process running inside a container?
 *
 * Distinct from getHostPlatform(), which answers "what OS is the HOST" — and
 * deliberately reports Docker Desktop as darwin so the native-services page
 * works. Both can be true at once: a containerised admin on a Mac host. Code
 * that touches the filesystem or spawns host tools needs THIS question, because
 * in a container those paths are ephemeral and belong to the container, not the
 * user's machine.
 *
 * Mirrors host-platform.ts: env override first (for tests and odd runtimes),
 * then detection, cached because it cannot change while the process lives.
 */
let cached: boolean | null = null

export function isContainerised(): boolean {
  if (cached !== null) return cached
  cached = compute()
  return cached
}

/** For tests: forget the cache so the next call re-detects. */
export function resetContainerisedCache(): void {
  cached = null
}

function compute(): boolean {
  const override = process.env.JARVIS_IN_CONTAINER?.trim().toLowerCase()
  if (override === 'true' || override === '1') return true
  if (override === 'false' || override === '0') return false
  // Docker writes this into every container it creates.
  return existsSync('/.dockerenv')
}
