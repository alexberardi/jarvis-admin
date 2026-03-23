#!/usr/bin/env node

import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// Set STATIC_DIR to the bundled frontend
const publicDir = join(root, 'public')
if (existsSync(publicDir)) {
  process.env.STATIC_DIR = publicDir
}

// Default port
if (!process.env.PORT) {
  process.env.PORT = '7711'
}

// Check Docker availability
try {
  execSync('docker info', { stdio: 'ignore', timeout: 5000 })
} catch {
  console.warn('\x1b[33m[jarvis-admin]\x1b[0m Docker not detected. Install wizard will have limited functionality.')
}

console.log(`\x1b[1m[jarvis-admin]\x1b[0m Starting on http://localhost:${process.env.PORT}`)
console.log(`\x1b[1m[jarvis-admin]\x1b[0m Open this URL in your browser to begin setup.\n`)

// Import and start the server
await import('../server/dist/index.js')
