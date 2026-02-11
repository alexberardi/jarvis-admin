import { hostname, cpus, totalmem, platform, release } from 'node:os'
import type { FastifyInstance } from 'fastify'
import { requireSuperuser } from '../middleware/auth.js'

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSuperuser)

  app.get('/info', async () => {
    return {
      hostname: hostname(),
      platform: platform(),
      release: release(),
      cpuCount: cpus().length,
      totalMemoryMb: Math.round(totalmem() / (1024 * 1024)),
      version: '0.1.0',
      uptime: process.uptime(),
    }
  })
}
