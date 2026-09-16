import type { ServiceRegistry } from '../types/service-registry.js'
import type { HostPlatform } from './host-platform.js'

/**
 * The registry as it applies to one host.
 *
 * A service may declare `platforms`; anything else runs everywhere. Filtering
 * here rather than in the UI means the wizard cannot offer something the
 * install step will refuse: jarvis-osx-api is macOS-only (host TCC grants, a
 * GUI session, a launchd job), but that was only written in its description, so
 * a Windows user was shown it, enabled it, and watched the install try to run a
 * launchd deploy script through bash:
 *
 *     <3>WSL ERROR: CreateProcessCommon:818: execvpe(/bin/bash) failed
 *
 * The native-services routes already answer "macOS only" with a 400, so the
 * install now fails politely rather than cryptically -- but a control that can
 * only ever fail should not be on the screen.
 */
export function registryForHost(
  registry: ServiceRegistry,
  platform: HostPlatform,
): ServiceRegistry {
  return {
    ...registry,
    services: registry.services.filter((service) => runsOn(service.platforms, platform)),
  }
}

/** Does a service's `platforms` (optional = anywhere) include this host? */
export function runsOn(
  platforms: ('darwin' | 'linux' | 'win32')[] | undefined,
  platform: HostPlatform,
): boolean {
  if (!platforms || platforms.length === 0) return true
  return platforms.includes(platform as 'darwin' | 'linux' | 'win32')
}
