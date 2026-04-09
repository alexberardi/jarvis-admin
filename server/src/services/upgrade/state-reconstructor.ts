import { platform } from 'node:os'
import type { WizardState } from '../../types/wizard.js'
import type { ServiceRegistry } from '../../types/service-registry.js'
import { serviceIdToPortVar } from '../generators/port-utils.js'
import { SECRET_KEYS } from '../generators/secret-generator.js'

/**
 * Reconstruct a WizardState from an existing .env file so we can
 * regenerate docker-compose.yml without losing the user's configuration.
 */
export function reconstructWizardState(
  existingEnv: Record<string, string>,
  registry: ServiceRegistry,
): WizardState {
  // Determine enabled modules by checking which port vars exist
  const enabledModules: string[] = []
  for (const svc of registry.services) {
    if (svc.category === 'core') continue // Core always included
    const portVar = serviceIdToPortVar(svc.id)
    if (existingEnv[portVar]) {
      enabledModules.push(svc.id)
    }
  }

  // Reconstruct port overrides
  const portOverrides: Record<string, number> = {}
  for (const svc of registry.services) {
    const portVar = serviceIdToPortVar(svc.id)
    const val = existingEnv[portVar]
    if (val && parseInt(val, 10) !== svc.port) {
      portOverrides[svc.id] = parseInt(val, 10)
    }
  }

  const infraPortOverrides: Record<string, number> = {}
  for (const inf of registry.infrastructure) {
    const portVar = serviceIdToPortVar(inf.id)
    const val = existingEnv[portVar]
    if (val && parseInt(val, 10) !== inf.port) {
      infraPortOverrides[inf.id] = parseInt(val, 10)
    }
  }

  // Reconstruct secrets
  const secrets: Record<string, string> = {}
  for (const key of SECRET_KEYS) {
    if (existingEnv[key]) {
      secrets[key] = existingEnv[key]!
    }
  }

  // Detect deployment mode
  const hasRemoteLlm = !!existingEnv.JARVIS_LLM_PROXY_URL
  const deploymentMode = hasRemoteLlm ? 'remote-llm' as const : 'local' as const

  return {
    currentStep: 0,
    totalSteps: 0,
    platform: platform() as 'darwin' | 'linux',
    hardware: null,
    enabledModules,
    portOverrides,
    infraPortOverrides,
    secrets,
    dbUser: existingEnv.DB_USER ?? 'jarvis',
    deploymentMode,
    remoteLlmUrl: existingEnv.JARVIS_LLM_PROXY_URL ?? '',
    remoteWhisperUrl: existingEnv.JARVIS_WHISPER_URL ?? '',
    whisperModel: 'base.en',
    llmInterface: existingEnv.LLM_INTERFACE_SEED ?? '',
    deploymentTarget: 'standard',
  }
}
