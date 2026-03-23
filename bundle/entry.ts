import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'

const binaryDir = join(process.execPath, '..')
const publicDir = join(binaryDir, 'public')
if (existsSync(publicDir)) {
  process.env.STATIC_DIR = resolve(publicDir)
}

await import('./server/dist/index.js')
