import type { FastifyInstance } from 'fastify'
import { VERSION } from '../version.js'

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: VERSION,
    }
  })
}
