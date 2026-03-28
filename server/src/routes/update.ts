import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { FastifyInstance } from 'fastify'
import { requireSuperuser } from '../middleware/auth.js'
import { checkForUpdate } from '../services/update-checker.js'

const UPGRADE_MARKER = join(homedir(), '.jarvis', 'upgrade-in-progress.json')

export interface UpgradeStatus {
  inProgress: boolean
  phase?: string
  version?: string
  startedAt?: string
}

function getUpgradeStatus(): UpgradeStatus {
  if (!existsSync(UPGRADE_MARKER)) {
    return { inProgress: false }
  }
  try {
    const data = JSON.parse(readFileSync(UPGRADE_MARKER, 'utf-8')) as {
      version: string
      phase: string
      startedAt: string
    }
    return { inProgress: true, ...data }
  } catch {
    return { inProgress: false }
  }
}

export async function updateRoutes(app: FastifyInstance): Promise<void> {
  /** Check for available updates (no auth required — informational) */
  app.get('/check', async (_request, reply) => {
    const info = await checkForUpdate()
    return reply.send(info)
  })

  /** Force a fresh update check */
  app.post('/check', async (_request, reply) => {
    const info = await checkForUpdate(true)
    return reply.send(info)
  })

  /** Get current upgrade status (is an upgrade in progress?) */
  app.get('/status', async (_request, reply) => {
    return reply.send(getUpgradeStatus())
  })

  /** Apply an update — SSE endpoint that orchestrates the full upgrade */
  app.post('/apply', { preHandler: requireSuperuser }, async (request, reply) => {
    const info = await checkForUpdate(true)
    if (!info.updateAvailable) {
      return reply.code(400).send({ error: 'No update available' })
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const emit = (data: Record<string, unknown>) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
      } catch {
        // Client disconnected
      }
    }

    try {
      // Import the upgrade orchestrator lazily (only when actually upgrading)
      const { runUpgrade } = await import('../services/upgrade/orchestrator.js')
      await runUpgrade(info.latestVersion, app, emit)
      emit({ done: true, code: 0 })
    } catch (err) {
      emit({ done: true, code: 1, error: err instanceof Error ? err.message : String(err) })
    }

    reply.raw.end()
  })
}
