import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { reconstructWizardState } from '../../src/services/upgrade/state-reconstructor.js'
import { generateCompose, type ImageDigestMap } from '../../src/services/generators/compose-generator.js'
import { generateEnv } from '../../src/services/generators/env-generator.js'
import { mergeEnv } from '../../src/services/upgrade/env-merger.js'
import { parseRegistry } from '../../src/services/generators/service-registry.js'

/**
 * GOLDEN PROD-SHAPE REGRESSION (2026-07-06 reconcile incident).
 *
 * A single admin reconcile on prod silently reverted FOUR things at once:
 * whisper CUDA→CPU image (STT 90ms→16s), TTS GPU passthrough (Kokoro→Piper),
 * command-center broker credentials (MQTT rc=5, all server→node flows dead),
 * and the llm-proxy image pin (stale digest whose migration tree predated the
 * DB → crash loop → 502).
 *
 * This test reconstructs wizard state from a prod-shaped .env (same KEYS as
 * the real one, fake secrets) with prod's detected hardware, regenerates the
 * compose + env exactly as a reconcile does, and asserts every property that
 * incident violated. If a generator change breaks any of these, prod breaks —
 * this must never go red silently.
 */

const FAKE = 'x'.repeat(64)

function prodShapedEnv(): Record<string, string> {
  return {
    // Secrets (fake values, real keys)
    POSTGRES_PASSWORD: FAKE, REDIS_PASSWORD: FAKE, AUTH_SECRET_KEY: FAKE,
    JARVIS_CONFIG_ADMIN_TOKEN: FAKE, JARVIS_AUTH_ADMIN_TOKEN: FAKE,
    ADMIN_API_KEY: FAKE, GRAFANA_ADMIN_PASSWORD: FAKE,
    MODEL_SERVICE_TOKEN: FAKE, MQTT_PASSWORD: FAKE,
    DB_USER: 'jarvis',
    // Enabled-module port markers (drives enabledModules reconstruction)
    CONFIG_SERVICE_PORT: '7700', AUTH_PORT: '7701', LOG_SERVER_PORT: '7702',
    COMMAND_CENTER_PORT: '7703', LLM_PROXY_API_PORT: '7704', WHISPER_API_PORT: '7706',
    TTS_PORT: '7707', ADMIN_PORT: '7711',
    // Release + platform
    JARVIS_IMAGE_TAG: 'latest', HOST_OS: 'linux',
    // The GPU-backend keys the 2026-07-04/06 incidents were about
    WHISPER_BACKEND: 'cuda', TTS_BACKEND: 'cuda', TTS_GPU_DEVICE: '1',
  }
}

// A digest map as the GHCR refresh returns it at update time.
const DIGESTS: ImageDigestMap = {
  'jarvis-whisper-api': { 'latest-cuda': 'sha256:' + 'a'.repeat(64) },
  'jarvis-llm-proxy-api': { 'latest-cuda': 'sha256:' + 'b'.repeat(64) },
}

function loadRegistry() {
  const raw = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../src/data/service-registry.json'), 'utf-8'),
  )
  return parseRegistry(raw)
}

function regenerate() {
  const registry = loadRegistry()
  const existingEnv = prodShapedEnv()
  const state = reconstructWizardState(existingEnv, registry)
  // What detection returns on the prod box (admin container sees the nvidia
  // docker runtime). Forced here because CI hosts have no GPU.
  state.platform = 'linux'
  state.hardware = {
    platform: 'linux', arch: 'x86_64', totalMemoryGb: 64,
    gpuName: 'NVIDIA GeForce RTX 3090', gpuVramMb: 24576, gpuType: 'nvidia',
    recommendedBackends: ['gguf'], recommendedBackend: 'gguf',
  }
  const compose = generateCompose(state, registry, DIGESTS)
  const env = mergeEnv(existingEnv, generateEnv(state, registry))
  return { compose, env }
}

function block(compose: string, id: string): string {
  const start = compose.indexOf(`\n  ${id}:\n`)
  expect(start, `${id} missing from compose`).toBeGreaterThanOrEqual(0)
  const after = compose.slice(start + id.length + 5)
  const next = after.search(/\n {2}[a-z][a-z0-9-]*:\n/)
  return next > 0 ? after.slice(0, next) : after
}

describe('prod-shape regression: a reconcile must preserve the GPU/broker deployment', () => {
  const { compose, env } = regenerate()

  it('whisper keeps its cuda variant and GPU passthrough (floating tag by default)', () => {
    const w = block(compose, 'jarvis-whisper-api')
    expect(w).toContain('jarvis-whisper-api:${JARVIS_IMAGE_TAG:-latest}-cuda')
    expect(w).toContain('driver: nvidia')
  })

  it('tts keeps single-GPU passthrough (never count:all) + kokoro device fallback', () => {
    const t = block(compose, 'jarvis-tts')
    expect(t).toContain("device_ids: ['${TTS_GPU_DEVICE:-0}']")
    expect(t).not.toContain('count: all')
    expect(t).toContain('TTS_KOKORO_DEVICE')
  })

  it('llm-proxy api AND worker keep the cuda variant + GPU + supervised serve.sh', () => {
    const api = block(compose, 'jarvis-llm-proxy-api')
    const worker = block(compose, 'llm-proxy-worker')
    expect(api).toContain('jarvis-llm-proxy-api:${JARVIS_IMAGE_TAG:-latest}-cuda')
    expect(worker).toContain('jarvis-llm-proxy-api:${JARVIS_IMAGE_TAG:-latest}-cuda')
    expect(api).toContain('driver: nvidia')
    expect(worker).toContain('driver: nvidia')
    expect(api).toContain('serve.sh')
  })

  it('floating tags by default: no @sha256 pins anywhere (2026-07-06 decision)', () => {
    expect(compose).not.toContain('@sha256:')
  })

  it('PIN_IMAGES=true opts back in to digest pins (supply-chain hardening)', () => {
    const registry = loadRegistry()
    const envWithPin = { ...prodShapedEnv(), PIN_IMAGES: 'true' }
    const state = reconstructWizardState(envWithPin, registry)
    state.platform = 'linux'
    state.hardware = {
      platform: 'linux', arch: 'x86_64', totalMemoryGb: 64,
      gpuName: 'NVIDIA GeForce RTX 3090', gpuVramMb: 24576, gpuType: 'nvidia',
      recommendedBackends: ['gguf'], recommendedBackend: 'gguf',
    }
    const pinned = generateCompose(state, registry, DIGESTS)
    expect(block(pinned, 'jarvis-whisper-api')).toContain('sha256:' + 'a'.repeat(64))
    expect(block(pinned, 'jarvis-llm-proxy-api')).toContain('sha256:' + 'b'.repeat(64))
  })

  it('command-center gets broker credentials that exist in .env (never a blank password)', () => {
    expect(block(compose, 'jarvis-command-center')).toContain('MQTT_PASSWORD')
    expect(env).toMatch(/^MQTT_PASSWORD=.+$/m)
  })

  it('.env keeps the GPU backend keys and existing secrets byte-for-byte', () => {
    expect(env).toMatch(/^WHISPER_BACKEND=cuda$/m)
    expect(env).toMatch(/^TTS_BACKEND=cuda$/m)
    expect(env).toMatch(/^TTS_GPU_DEVICE=1$/m)
    expect(env).toContain(`AUTH_SECRET_KEY=${FAKE}`)
    expect(env).toMatch(/^MODEL_SERVICE_TOKEN=.+$/m)
  })
})
