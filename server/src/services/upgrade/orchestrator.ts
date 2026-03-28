import type { FastifyInstance } from 'fastify'
import { selfUpdate } from './self-updater.js'
import { upgradeCompose } from './compose-upgrader.js'

type Emit = (data: Record<string, unknown>) => void

/**
 * Run the full upgrade flow:
 * 1. Preflight checks
 * 2. Download new binary + assets
 * 3. Atomic binary swap + restart
 * --- process restarts, resumes from marker ---
 * 4. Regenerate compose + merge env
 * 5. Pull new images
 * 6. Restart services in tier order
 * 7. Verify health
 */
export async function runUpgrade(
  targetVersion: string,
  app: FastifyInstance,
  emit: Emit,
): Promise<void> {
  // Phase 1: Preflight
  emit({ phase: 'preflight', message: 'Checking prerequisites...' })
  if (!app.docker) {
    throw new Error('Docker is not available')
  }

  // Phase 2: Download new binary
  emit({ phase: 'download', message: `Downloading Jarvis v${targetVersion}...` })
  await selfUpdate(targetVersion, emit)

  // Phase 3 happens inside selfUpdate: atomic swap + restart marker + process restart
  // After restart, the new binary reads the marker and calls resumeUpgrade()
}

/**
 * Resume upgrade after binary restart. Called from startup hook.
 */
export async function resumeUpgrade(
  app: FastifyInstance,
  marker: { version: string; phase: string; startedAt: string },
  emit: Emit,
): Promise<void> {
  const { version } = marker

  // Phase 4: Regenerate compose + merge env
  emit({ phase: 'compose', message: 'Updating configuration...' })
  await upgradeCompose(app)

  // Phase 5: Pull new images
  emit({ phase: 'pull', message: 'Pulling updated images...' })
  const { pullImages, restartServices, verifyHealth } = await import('./service-updater.js')
  await pullImages(app, emit)

  // Phase 6: Restart services
  emit({ phase: 'restart', message: 'Restarting services...' })
  await restartServices(app, emit)

  // Phase 7: Verify health
  emit({ phase: 'verify', message: 'Verifying health...' })
  await verifyHealth(app, emit)

  emit({ phase: 'done', message: `Upgrade to v${version} complete!` })
}
