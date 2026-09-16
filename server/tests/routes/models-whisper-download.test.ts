/**
 * The wizard's Models step must not 500 on a Docker install.
 *
 * A user installing on a Mac with Docker reported "error 500 when finally
 * getting to the model selection point". The Models step calls
 * POST /api/models/whisper-autodownload unconditionally -- its checkbox
 * defaults to on -- and that handler fetched the whisper model by shelling out
 * to `curl`. The admin image is node:22-alpine, which ships wget, not curl:
 *
 *     $ docker exec jarvis-admin node -e "execFile('curl', ...)"
 *     err.code : ENOENT
 *     message  : spawn curl ENOENT
 *
 * verified against a live admin container. So the endpoint returned
 * `500 Whisper model download failed: spawn curl ENOENT` on EVERY Docker
 * install that reached the step, on any host OS -- the Mac was incidental.
 *
 * Two independent fixes, both tested here: the download no longer needs an
 * external binary, and it is not attempted at all in a container, where
 * homedir() is the container's own ephemeral /root rather than anywhere the
 * whisper service would look.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { resetContainerisedCache } from '../../src/services/runtime-env.js'

function meResponse(): Response {
  return new Response(JSON.stringify({ id: 1, email: 'a@test.com', is_superuser: true }),
    { status: 200, headers: { 'content-type': 'application/json' } })
}

const AUTH = { authorization: 'Bearer good' }

describe('POST /api/models/whisper-autodownload', () => {
  let app: FastifyInstance
  let composePath: string
  let fakeHome: string
  let realHome: string | undefined

  beforeEach(async () => {
    composePath = mkdtempSync(join(tmpdir(), 'jarvis-whisper-cp-'))
    writeFileSync(join(composePath, '.env'), 'DB_USER=jarvis\n')
    fakeHome = mkdtempSync(join(tmpdir(), 'jarvis-whisper-home-'))
    realHome = process.env.HOME
    process.env.HOME = fakeHome              // keep the download off the real home
    process.env.JARVIS_COMPOSE_PATH = composePath
    resetContainerisedCache()
    app = await buildApp({ config: { authUrl: 'http://fake-auth:7701' } })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    if (realHome === undefined) delete process.env.HOME
    else process.env.HOME = realHome
    delete process.env.JARVIS_COMPOSE_PATH
    delete process.env.JARVIS_IN_CONTAINER
    resetContainerisedCache()
    rmSync(composePath, { recursive: true, force: true })
    rmSync(fakeHome, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('in a container: succeeds without downloading anything', async () => {
    process.env.JARVIS_IN_CONTAINER = 'true'
    resetContainerisedCache()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      if (String(input).includes('fake-auth')) return meResponse()
      throw new Error('the container path must not download anything')
    })

    const res = await app.inject({
      method: 'POST', url: '/api/models/whisper-autodownload',
      headers: AUTH, payload: { enabled: true },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ success: true, downloaded: false })
    // Only the auth check went out — no huggingface call.
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]))
    expect(urls.filter((u) => u.includes('huggingface'))).toEqual([])
    expect(existsSync(join(fakeHome, 'whisper.cpp', 'models', 'ggml-base.en.bin'))).toBe(false)
  })

  it('in a container: still records the flag in .env for the whisper service', async () => {
    process.env.JARVIS_IN_CONTAINER = 'true'
    resetContainerisedCache()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(meResponse())

    await app.inject({
      method: 'POST', url: '/api/models/whisper-autodownload',
      headers: AUTH, payload: { enabled: true },
    })

    expect(readFileSync(join(composePath, '.env'), 'utf-8'))
      .toContain('WHISPER_ALLOW_MODEL_AUTODOWNLOAD=true')
  })

  it('natively: downloads through node, with no external binary', async () => {
    process.env.JARVIS_IN_CONTAINER = 'false'
    resetContainerisedCache()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const u = String(input)
      if (u.includes('fake-auth')) return meResponse()
      if (u.includes('huggingface.co') && u.includes('ggml-base.en.bin')) {
        return new Response('GGML-MODEL-BYTES', { status: 200 })
      }
      return new Response('', { status: 404 })
    })

    const res = await app.inject({
      method: 'POST', url: '/api/models/whisper-autodownload',
      headers: AUTH, payload: { enabled: true },
    })

    expect(res.statusCode).toBe(200)
    const dest = join(fakeHome, 'whisper.cpp', 'models', 'ggml-base.en.bin')
    expect(existsSync(dest)).toBe(true)
    expect(await readFile(dest, 'utf-8')).toBe('GGML-MODEL-BYTES')
  })

  it('natively: a failed download reports the real reason, never a missing binary', async () => {
    process.env.JARVIS_IN_CONTAINER = 'false'
    resetContainerisedCache()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      if (String(input).includes('fake-auth')) return meResponse()
      return new Response('nope', { status: 503, statusText: 'Service Unavailable' })
    })

    const res = await app.inject({
      method: 'POST', url: '/api/models/whisper-autodownload',
      headers: AUTH, payload: { enabled: true },
    })

    expect(res.statusCode).toBe(500)
    const error = String(res.json().error)
    expect(error).toContain('503')
    expect(error).not.toContain('ENOENT')
    expect(error).not.toContain('curl')
    // And a failed attempt leaves nothing that looks like a model.
    expect(existsSync(join(fakeHome, 'whisper.cpp', 'models', 'ggml-base.en.bin'))).toBe(false)
  }, 20_000)

  it('natively: a download that dies mid-stream leaves no partial model', async () => {
    // The cleanup path only runs when bytes have already been written, which a
    // non-200 never reaches -- so this streams some data and then errors. A
    // half-written file is the bad outcome: it looks like a model, and the
    // service fails to load it much later, far away from this cause.
    process.env.JARVIS_IN_CONTAINER = 'false'
    resetContainerisedCache()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      if (String(input).includes('fake-auth')) return meResponse()
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('PARTIAL-MODEL-BYTES'))
          controller.error(new Error('connection reset by peer'))
        },
      })
      return new Response(body, { status: 200 })
    })

    const res = await app.inject({
      method: 'POST', url: '/api/models/whisper-autodownload',
      headers: AUTH, payload: { enabled: true },
    })

    expect(res.statusCode).toBe(500)
    expect(existsSync(join(fakeHome, 'whisper.cpp', 'models', 'ggml-base.en.bin'))).toBe(false)
  }, 20_000)

  it('enabled:false writes the flag and does nothing else', async () => {
    process.env.JARVIS_IN_CONTAINER = 'false'
    resetContainerisedCache()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(meResponse())

    const res = await app.inject({
      method: 'POST', url: '/api/models/whisper-autodownload',
      headers: AUTH, payload: { enabled: false },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ enabled: false, downloaded: false })
  })
})

describe('the admin image ships no curl, so nothing may shell out to it', () => {
  it('no source file spawns curl', async () => {
    const { readdirSync, statSync } = await import('node:fs')
    const root = join(import.meta.dirname, '..', '..', 'src')
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full)
        // The CALL, not the word: an earlier version of this matched any
        // mention of curl and flagged the comment explaining why curl is gone.
        else if (entry.endsWith('.ts')
                 && /(execFile|execSync|spawn|spawnSync)\(\s*['"`]curl['"`]/.test(readFileSync(full, 'utf-8'))) {
          offenders.push(full.slice(root.length + 1))
        }
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})
