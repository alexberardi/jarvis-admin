import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { ServiceRegistry } from '../../types/service-registry.js'
import { generateCompose, getAllEnabledServices } from '../generators/compose-generator.js'
import { generateEnv } from '../generators/env-generator.js'
import { generateInitDbScript } from '../generators/init-db-generator.js'
import { parseRegistry } from '../generators/service-registry.js'
import { reconstructWizardState } from './state-reconstructor.js'
import { mergeEnv } from './env-merger.js'
import { VERSION } from '../../version.js'
import { getComposePath } from '../compose-path.js'
import { getHostComposePath } from '../host-paths.js'
import registryData from '../../data/service-registry.json' with { type: 'json' }

function loadEnvFile(composePath: string): Record<string, string> {
  const envFile = join(composePath, '.env')
  if (!existsSync(envFile)) return {}
  const vars: Record<string, string> = {}
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1)
  }
  return vars
}

/**
 * Upgrade the compose + env files in place, preserving secrets and user config.
 *
 * Steps:
 * 1. Back up current files
 * 2. Load existing .env
 * 3. Reconstruct WizardState from existing config
 * 4. Generate new compose from updated registry
 * 5. Generate new env template, merge with existing values
 * 6. Regenerate init-db.sh for any new databases
 */
export interface UpgradeOverrides {
  enabledModules?: string[]
  relayEnabled?: boolean
  relayUrl?: string
}

export async function upgradeCompose(
  _app: FastifyInstance,
  overrides?: UpgradeOverrides,
): Promise<void> {
  const composePath = getComposePath()
  const registry: ServiceRegistry = parseRegistry(registryData)

  // Step 1: Backup
  const backupDir = join(composePath, `backup-${VERSION}`)
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true })
    for (const file of ['docker-compose.yml', '.env', 'init-db.sh']) {
      const src = join(composePath, file)
      if (existsSync(src)) {
        cpSync(src, join(backupDir, file))
      }
    }
  }

  // Step 2: Load existing env
  const existingEnv = loadEnvFile(composePath)

  // Step 3: Reconstruct state, apply overrides from reconcile options
  const state = reconstructWizardState(existingEnv, registry)
  if (overrides?.enabledModules) {
    state.enabledModules = overrides.enabledModules
  }
  if (overrides?.relayEnabled !== undefined) {
    state.relayEnabled = overrides.relayEnabled
  }
  if (overrides?.relayUrl) {
    state.relayUrl = overrides.relayUrl
  }

  // When admin runs in docker, fetch the absolute host path of the compose
  // dir we were mounted at. env-generator uses it to write MODELS_DIR so
  // bind mounts in the regenerated compose resolve on the host (otherwise
  // they resolve to /host/compose/.models — a path that exists in the admin
  // container but not on the host, so the daemon binds an empty directory).
  const hostPath = await getHostComposePath()
  if (hostPath) {
    state.hostComposePath = hostPath
  }

  // Step 4: Generate new compose
  const newCompose = generateCompose(state, registry)
  writeFileSync(join(composePath, 'docker-compose.yml'), newCompose)

  // Step 5: Generate new env template, merge
  const newEnvTemplate = generateEnv(state, registry)
  const mergedEnv = mergeEnv(existingEnv, newEnvTemplate)
  writeFileSync(join(composePath, '.env'), mergedEnv)

  // Step 6: Regenerate init-db.sh
  const enabledServices = getAllEnabledServices(state, registry)
  const primaryDb = registry.infrastructure.find((i) => i.id === 'postgres')
    ?.envVars.find((e) => e.name === 'POSTGRES_DB')?.default ?? 'jarvis_config'
  const initDb = generateInitDbScript(enabledServices, primaryDb)
  writeFileSync(join(composePath, 'init-db.sh'), initDb, { mode: 0o755 })
}
