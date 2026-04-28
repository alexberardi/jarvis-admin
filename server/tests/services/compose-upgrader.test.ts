import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { upgradeCompose } from '../../src/services/upgrade/compose-upgrader.js'

/**
 * Minimal valid starting state — registry-conformant .env keys for core services
 * so reconstructWizardState recognises an existing install.
 */
function writeFakeInstall(composePath: string, extra: Record<string, string> = {}): void {
  mkdirSync(composePath, { recursive: true })
  const envLines = [
    'DB_USER=jarvis',
    'POSTGRES_PASSWORD=p',
    'AUTH_SECRET_KEY=' + 'a'.repeat(64),
    'JARVIS_CONFIG_ADMIN_TOKEN=' + 'b'.repeat(64),
    'JARVIS_AUTH_ADMIN_TOKEN=' + 'c'.repeat(64),
    'ADMIN_API_KEY=' + 'd'.repeat(64),
    'CONFIG_SERVICE_PORT=7700',
    'AUTH_PORT=7701',
    'LOG_SERVER_PORT=7702',
    'COMMAND_CENTER_PORT=7703',
    'TTS_PORT=7707',
    ...Object.entries(extra).map(([k, v]) => `${k}=${v}`),
  ]
  writeFileSync(join(composePath, '.env'), envLines.join('\n') + '\n')
  writeFileSync(join(composePath, 'docker-compose.yml'), 'services: {}\n')
}

describe('upgradeCompose with UpgradeOverrides', () => {
  let composePath: string
  const fakeApp = {} as unknown as FastifyInstance

  beforeEach(() => {
    composePath = mkdtempSync(join(tmpdir(), 'jarvis-upgrade-'))
    process.env.JARVIS_COMPOSE_PATH = composePath
  })

  afterEach(() => {
    delete process.env.JARVIS_COMPOSE_PATH
    rmSync(composePath, { recursive: true, force: true })
  })

  it('honors relayEnabled + relayUrl override — writes to .env and templated env on CC', async () => {
    writeFakeInstall(composePath)

    await upgradeCompose(fakeApp, {
      relayEnabled: true,
      relayUrl: 'https://relay.example.com',
    })

    const env = readFileSync(join(composePath, '.env'), 'utf-8')
    expect(env).toContain('JARVIS_RELAY_URL=https://relay.example.com')

    const compose = readFileSync(join(composePath, 'docker-compose.yml'), 'utf-8')
    expect(compose).toContain('JARVIS_RELAY_URL: ${JARVIS_RELAY_URL:-}')
  })

  it('omits relay output when relayEnabled override is false', async () => {
    // Start with relay enabled in .env, then override to disabled.
    writeFakeInstall(composePath, { JARVIS_RELAY_URL: 'https://relay.example.com' })

    await upgradeCompose(fakeApp, { relayEnabled: false })

    // env-merger preserves existing values it doesn't recognise; relay may
    // remain in .env (won't hurt), but the compose drops the templated env
    // line entirely when relayEnabled is false.
    const compose = readFileSync(join(composePath, 'docker-compose.yml'), 'utf-8')
    expect(compose).not.toContain('JARVIS_RELAY_URL:')
  })

  it('honors enabledModules override — drops services missing from list', async () => {
    // Starting state: tts is enabled (TTS_PORT in .env). Override to disable it.
    writeFakeInstall(composePath)

    await upgradeCompose(fakeApp, { enabledModules: [] })

    const compose = readFileSync(join(composePath, 'docker-compose.yml'), 'utf-8')
    // jarvis-tts (recommended) should be gone; core services stay.
    expect(compose).toContain('jarvis-command-center:')
    expect(compose).not.toMatch(/^ {2}jarvis-tts:/m)
  })

  it('creates a backup directory before regenerating', async () => {
    writeFakeInstall(composePath)

    await upgradeCompose(fakeApp, { relayEnabled: true })

    // backup-<VERSION> dir should exist with the pre-upgrade docker-compose.yml
    const backupDirs = ['backup-0.0.0-dev', 'backup-dev'].concat(
      Array.from({ length: 50 }, (_, i) => `backup-0.1.${i}`),
    )
    const found = backupDirs.find((d) => existsSync(join(composePath, d)))
    expect(found).toBeDefined()
  })
})
