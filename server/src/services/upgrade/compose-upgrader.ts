import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { ServiceRegistry } from '../../types/service-registry.js'
import type { TtsBackend, WhisperBackend } from '../../types/wizard.js'
import { generateCompose, getAllEnabledServices, type ImageDigestMap } from '../generators/compose-generator.js'
import { generateEnv } from '../generators/env-generator.js'
import { generateInitDbScript } from '../generators/init-db-generator.js'
import { parseRegistry } from '../generators/service-registry.js'
import { reconstructWizardState } from './state-reconstructor.js'
import { refreshDigestsForTrack } from './image-digest-resolver.js'
import { mergeEnv } from './env-merger.js'
import { VERSION } from '../../version.js'
import { getComposePath } from '../compose-path.js'
import { getHostComposePath } from '../host-paths.js'
import registryData from '../../data/service-registry.json' with { type: 'json' }

/**
 * Set ``key=value`` in a .env string: replace the line in place if the key
 * exists, otherwise append it. Used for operational flags (e.g. the broker lock)
 * that must win over the merge preservation rule.
 */
function upsertEnvVar(env: string, key: string, value: string): string {
  const line = `${key}=${value}`
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  if (pattern.test(env)) return env.replace(pattern, line)
  const base = env.endsWith('\n') ? env : env + '\n'
  return base + line + '\n'
}

export function loadEnvFile(composePath: string): Record<string, string> {
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

export interface UpgradedComposeFiles {
  compose: string
  env: string
  initDb: string
}

/**
 * PURE regeneration core: reconstruct the wizard state from an existing install's
 * env and produce the upgraded compose / .env / init-db.sh as STRINGS. Writes
 * nothing. Both the in-place upgrader and the download/CLI path build on this so
 * they can never diverge.
 *
 * Secrets and user config are preserved because they're recovered from
 * ``existingEnv`` (via reconstructWizardState + mergeEnv); named data volumes are
 * matched by Docker on ``up`` since the generator emits stable names, and
 * bind-mount host paths come from env too. A regenerated file is CANONICAL — any
 * hand-edits to the original compose are intentionally not carried over.
 */
export function buildUpgradedComposeFiles(
  existingEnv: Record<string, string>,
  registry: ServiceRegistry,
  overrides?: UpgradeOverrides,
  hostComposePath?: string,
  digests?: ImageDigestMap,
): UpgradedComposeFiles {
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
  if (overrides?.whisperModelPath) {
    state.whisperModelPath = overrides.whisperModelPath
  }
  if (overrides?.whisperBackend) {
    state.whisperBackend = overrides.whisperBackend
  }
  if (overrides?.ttsBackend) {
    state.ttsBackend = overrides.ttsBackend
  }
  if (overrides?.pinImages !== undefined) {
    state.pinImages = overrides.pinImages
  }
  if (overrides?.releaseTrack) {
    state.releaseTrack = overrides.releaseTrack
  }
  if (hostComposePath) {
    state.hostComposePath = hostComposePath
  }

  const compose = generateCompose(state, registry, digests)
  const newEnvTemplate = generateEnv(state, registry)
  let env = mergeEnv(existingEnv, newEnvTemplate)

  // Broker lock flag is operational, not user config.
  //  - An explicit override always wins over mergeEnv's "existing value wins".
  //  - A previously-written MQTT_ALLOW_ANON is preserved by mergeEnv, so a lock
  //    stays locked (and an open transition stays open) across routine regens.
  //  - The fresh-install template now sets MQTT_ALLOW_ANON=false, but an UPGRADE
  //    of an install that predates that change (no MQTT_ALLOW_ANON in its .env)
  //    must NOT inherit the locked default — its nodes may not have fetched
  //    broker creds yet, and locking would drop the whole fleet. Force the
  //    transition window (true) in that case; the operator locks explicitly from
  //    the admin UI once nodes have migrated.
  if (overrides?.mqttAllowAnon !== undefined) {
    env = upsertEnvVar(env, 'MQTT_ALLOW_ANON', String(overrides.mqttAllowAnon))
  } else if (existingEnv['MQTT_ALLOW_ANON'] === undefined) {
    env = upsertEnvVar(env, 'MQTT_ALLOW_ANON', 'true')
  }

  const enabledServices = getAllEnabledServices(state, registry)
  const primaryDb = registry.infrastructure.find((i) => i.id === 'postgres')
    ?.envVars.find((e) => e.name === 'POSTGRES_DB')?.default ?? 'jarvis_config'
  const initDb = generateInitDbScript(enabledServices, primaryDb)

  return { compose, env, initDb }
}

/**
 * Non-destructive regeneration for the "download / hand it to the user" flow:
 * read the existing install's env from ``composePath`` and return the upgraded
 * files as strings WITHOUT touching anything on disk. Used by the compose-mode
 * migrator (installer CLI) and the admin download endpoint.
 */
export function regenerateComposeFiles(
  composePath: string,
  overrides?: UpgradeOverrides,
  hostComposePath?: string,
): UpgradedComposeFiles {
  const registry: ServiceRegistry = parseRegistry(registryData)
  const existingEnv = loadEnvFile(composePath)
  return buildUpgradedComposeFiles(existingEnv, registry, overrides, hostComposePath)
}

/**
 * Like {@link regenerateComposeFiles}, but first refreshes the pinned image
 * digests from GHCR so the downloaded compose points at the NEWEST published
 * build (the bundled map is frozen at admin-build time). Async — the refresh is
 * a network round-trip; a resolver failure degrades to the bundled map and never
 * throws. Backs the "Update stack to latest" download: the operator applies it
 * themselves with `docker compose pull && docker compose up -d` (so it can also
 * update jarvis-admin, which the in-place reconcile can't recreate from itself).
 */
export async function regenerateComposeFilesLatest(
  composePath: string,
  overrides?: UpgradeOverrides,
  hostComposePath?: string,
): Promise<UpgradedComposeFiles> {
  const registry: ServiceRegistry = parseRegistry(registryData)
  const existingEnv = loadEnvFile(composePath)
  // dev floats (no digest pins), so only the stable track needs a refresh.
  const track =
    overrides?.releaseTrack === 'dev' ||
    (overrides?.releaseTrack === undefined && existingEnv.JARVIS_IMAGE_TAG === 'dev')
      ? 'dev'
      : 'latest'
  const digests = track === 'latest' ? await refreshDigestsForTrack('latest') : undefined
  return buildUpgradedComposeFiles(existingEnv, registry, overrides, hostComposePath, digests)
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
  whisperModelPath?: string
  whisperBackend?: WhisperBackend
  ttsBackend?: TtsBackend
  pinImages?: boolean
  releaseTrack?: 'stable' | 'dev'
  /**
   * Flip the MQTT broker's ``allow_anonymous`` (the transition→lockdown control).
   * ``false`` locks the broker to authenticated clients only; ``true`` re-opens
   * it. Undefined leaves the current state untouched. This is an operational
   * flag, not user config, so an explicit value wins over env preservation.
   */
  mqttAllowAnon?: boolean
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

  // Refresh the pinned image digests from GHCR so the regenerated compose points
  // at the newest published build and `docker compose pull` actually fetches it
  // (the bundled digest map is frozen at admin-build time, which otherwise makes
  // pull a no-op and deadlocks updates). Only the stable track pins — dev floats
  // — and a resolver failure degrades to the bundled map, so this never blocks
  // an upgrade.
  const track =
    overrides?.releaseTrack === 'dev' ||
    (overrides?.releaseTrack === undefined && existingEnv.JARVIS_IMAGE_TAG === 'dev')
      ? 'dev'
      : 'latest'
  const digests: ImageDigestMap | undefined =
    track === 'latest' ? await refreshDigestsForTrack('latest') : undefined

  // Step 3-6: Reconstruct + regenerate via the shared pure core.
  //
  // When admin runs in docker, fetch the absolute host path of the compose
  // dir we were mounted at. env-generator uses it to write MODELS_DIR so
  // bind mounts in the regenerated compose resolve on the host (otherwise
  // they resolve to /host/compose/.models — a path that exists in the admin
  // container but not on the host, so the daemon binds an empty directory).
  const hostPath = await getHostComposePath()
  const { compose, env, initDb } = buildUpgradedComposeFiles(
    existingEnv,
    registry,
    overrides,
    hostPath || undefined,
    digests,
  )

  writeFileSync(join(composePath, 'docker-compose.yml'), compose)
  writeFileSync(join(composePath, '.env'), env)
  writeFileSync(join(composePath, 'init-db.sh'), initDb, { mode: 0o755 })
}
