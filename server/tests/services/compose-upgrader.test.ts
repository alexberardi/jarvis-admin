import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { upgradeCompose, regenerateComposeFiles } from '../../src/services/upgrade/compose-upgrader.js'

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

  it('reconciles a relay-enabled install missing the household JWT — adds placeholder + wires notifications', async () => {
    // Reproduces the prod state: JARVIS_RELAY_URL is set, but neither
    // JARVIS_RELAY_HOUSEHOLD_JWT nor the per-container RELAY_* envs exist.
    writeFakeInstall(composePath, {
      JARVIS_RELAY_URL: 'https://relay.jarvisautomation.io',
      NOTIFICATIONS_PORT: '7712',
    })

    await upgradeCompose(fakeApp)

    const env = readFileSync(join(composePath, '.env'), 'utf-8')
    expect(env).toContain('JARVIS_RELAY_URL=https://relay.jarvisautomation.io')
    expect(env).toMatch(/JARVIS_RELAY_HOUSEHOLD_JWT=\s*$/m)

    const compose = readFileSync(join(composePath, 'docker-compose.yml'), 'utf-8')
    const notifIdx = compose.indexOf('jarvis-notifications:')
    const nextSvcIdx = compose.indexOf('\n  jarvis-', notifIdx + 1)
    const notifBlock = compose.slice(notifIdx, nextSvcIdx === -1 ? undefined : nextSvcIdx)
    expect(notifBlock).toContain('RELAY_URL: ${JARVIS_RELAY_URL:-}')
    expect(notifBlock).toContain('RELAY_HOUSEHOLD_JWT: ${JARVIS_RELAY_HOUSEHOLD_JWT:-}')
  })

  it('preserves an existing JARVIS_RELAY_HOUSEHOLD_JWT through reconcile', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.preserved'
    writeFakeInstall(composePath, {
      JARVIS_RELAY_URL: 'https://relay.jarvisautomation.io',
      JARVIS_RELAY_HOUSEHOLD_JWT: jwt,
      NOTIFICATIONS_PORT: '7712',
    })

    await upgradeCompose(fakeApp)

    const env = readFileSync(join(composePath, '.env'), 'utf-8')
    expect(env).toContain(`JARVIS_RELAY_HOUSEHOLD_JWT=${jwt}`)
  })

  it('migrates every registry migrate-set service on regenerate — including the previously-missing config-service', async () => {
    // Root incident: config-service shipped migration 005 (services.external_host)
    // but its compose never ran `alembic upgrade head`, so every /services query
    // 500'd. The upgrader must now wrap EVERY registry `migrate: true` service in
    // the alembic-then-exec entrypoint, not just cc/whisper/llm-proxy.
    writeFakeInstall(composePath)

    await upgradeCompose(fakeApp)

    const compose = readFileSync(join(composePath, 'docker-compose.yml'), 'utf-8')

    function block(id: string): string {
      const start = compose.indexOf(`\n  ${id}:\n`)
      expect(start, `${id} missing from regenerated compose`).toBeGreaterThanOrEqual(0)
      const after = compose.slice(start + `\n  ${id}:\n`.length)
      const next = after.match(/\n {2}[a-z][a-z0-9-]*:\n/)
      return next ? after.slice(0, next.index) : after
    }

    // Every enabled `migrate: true` service must carry the entrypoint wrapper —
    // including config-service, the one that 500'd.
    for (const id of [
      'jarvis-config-service',
      'jarvis-auth',
      'jarvis-command-center',
    ]) {
      const b = block(id)
      expect(b, `${id} should have the migrate entrypoint`).toContain('entrypoint:')
      expect(b).toContain('python -m alembic upgrade head && exec "$@"')
      expect(b).toContain('- jarvis-migrate')
    }

    // ...and an enabled service that is NOT in the migrate set must NOT get it —
    // proves the registry flag gates the wrapper. jarvis-logs is intentionally
    // deferred (its image doesn't ship alembic and its prod DB is un-stamped),
    // so it must come up exactly as before, with no migrate entrypoint.
    expect(block('jarvis-logs'), 'deferred service must not get the migrate entrypoint')
      .not.toContain('jarvis-migrate')
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

describe('regenerateComposeFiles (non-destructive)', () => {
  let composePath: string

  beforeEach(() => {
    composePath = mkdtempSync(join(tmpdir(), 'jarvis-regen-'))
    process.env.JARVIS_COMPOSE_PATH = composePath
  })

  afterEach(() => {
    delete process.env.JARVIS_COMPOSE_PATH
    rmSync(composePath, { recursive: true, force: true })
  })

  it('returns regenerated files as strings without touching the originals', () => {
    writeFakeInstall(composePath)
    const originalCompose = readFileSync(join(composePath, 'docker-compose.yml'), 'utf-8')
    const originalEnv = readFileSync(join(composePath, '.env'), 'utf-8')

    const result = regenerateComposeFiles(composePath)

    // Produced a real, fuller compose than the stub we started with.
    expect(result.compose).toContain('services:')
    expect(result.compose.length).toBeGreaterThan(originalCompose.length)
    expect(result.initDb.length).toBeGreaterThan(0)

    // Source files are byte-for-byte untouched.
    expect(readFileSync(join(composePath, 'docker-compose.yml'), 'utf-8')).toBe(originalCompose)
    expect(readFileSync(join(composePath, '.env'), 'utf-8')).toBe(originalEnv)
  })

  it('preserves existing secrets in the regenerated env', () => {
    writeFakeInstall(composePath)

    const result = regenerateComposeFiles(composePath)

    // The old secret values are carried forward, not re-minted.
    expect(result.env).toContain('AUTH_SECRET_KEY=' + 'a'.repeat(64))
    expect(result.env).toContain('JARVIS_AUTH_ADMIN_TOKEN=' + 'c'.repeat(64))
    expect(result.env).toContain('ADMIN_API_KEY=' + 'd'.repeat(64))
  })

  it('applies overrides in the returned files', () => {
    writeFakeInstall(composePath)

    const result = regenerateComposeFiles(composePath, {
      relayEnabled: true,
      relayUrl: 'https://relay.example.com',
    })

    expect(result.env).toContain('JARVIS_RELAY_URL=https://relay.example.com')
  })

  it('preserves the existing MQTT_PASSWORD across regen (nodes hold this password)', () => {
    // Re-minting the broker password on regen would silently orphan every node
    // (they carry the old password in their config) once the broker locks down.
    writeFakeInstall(composePath, { MQTT_PASSWORD: 'e'.repeat(32) })

    const result = regenerateComposeFiles(composePath)

    expect(result.env).toContain('MQTT_PASSWORD=' + 'e'.repeat(32))
  })
})
