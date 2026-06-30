import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateCompose, getAllEnabledServices, getComposeServices, getComposeWorkerIds } from '../../src/services/generators/compose-generator.js'
import { parseRegistry } from '../../src/services/generators/service-registry.js'
import type { ServiceRegistry } from '../../src/types/service-registry.js'
import type { WizardState } from '../../src/types/wizard.js'

function loadRegistry(): ServiceRegistry {
  const raw = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../src/data/service-registry.json'), 'utf-8'),
  )
  return parseRegistry(raw)
}

function makeState(overrides: Partial<WizardState> = {}): WizardState {
  return {
    currentStep: 0,
    totalSteps: 7,
    enabledModules: ['jarvis-whisper-api', 'jarvis-tts'],
    portOverrides: {},
    infraPortOverrides: {},
    secrets: {},
    dbUser: 'jarvis',
    whisperModel: 'base.en',
    whisperModelPath: '/whisper-models/ggml-base.en.bin',
    llmInterface: 'JarvisToolModel',
    deploymentMode: 'local',
    deploymentTarget: 'standard',
    remoteLlmUrl: '',
    remoteWhisperUrl: '',
    platform: 'linux',
    hardware: null,
    releaseTrack: 'stable' as const,
    relayEnabled: false,
    relayUrl: '',
    nativeServices: [],
    ...overrides,
  }
}

describe('compose-generator', () => {
  const registry = loadRegistry()

  it('generates valid compose YAML structure', () => {
    const state = makeState()
    const output = generateCompose(state, registry)
    expect(output).toContain('services:')
    expect(output).toContain('networks:')
    expect(output).toContain('volumes:')
  })

  it('includes core services always', () => {
    const state = makeState({ enabledModules: [] })
    const output = generateCompose(state, registry)
    expect(output).toContain('jarvis-config-service:')
    expect(output).toContain('jarvis-auth:')
    expect(output).toContain('jarvis-logs:')
    expect(output).toContain('jarvis-command-center:')
  })

  it('includes enabled recommended services', () => {
    const state = makeState({ enabledModules: ['jarvis-tts'] })
    const output = generateCompose(state, registry)
    expect(output).toContain('jarvis-tts:')
  })

  it('excludes non-enabled optional services', () => {
    const state = makeState({ enabledModules: [] })
    const output = generateCompose(state, registry)
    expect(output).not.toContain('jarvis-web:')
  })

  it('includes extra_hosts for host.docker.internal', () => {
    const state = makeState()
    const output = generateCompose(state, registry)
    expect(output).toContain('host.docker.internal:host-gateway')
  })

  it('includes app-to-app auth placeholders', () => {
    const state = makeState()
    const output = generateCompose(state, registry)
    expect(output).toContain('JARVIS_APP_ID')
    expect(output).toContain('JARVIS_APP_KEY')
  })

  describe('macOS GPU service exclusion', () => {
    it('excludes llm-proxy from compose on darwin', () => {
      const state = makeState({
        platform: 'darwin',
        enabledModules: ['jarvis-llm-proxy-api', 'jarvis-tts'],
      })
      const services = getComposeServices(state, registry)
      const ids = services.map((s) => s.id)
      expect(ids).not.toContain('jarvis-llm-proxy-api')
    })

    it('includes llm-proxy in compose on linux', () => {
      const state = makeState({
        platform: 'linux',
        enabledModules: ['jarvis-llm-proxy-api', 'jarvis-tts'],
      })
      const services = getComposeServices(state, registry)
      const ids = services.map((s) => s.id)
      expect(ids).toContain('jarvis-llm-proxy-api')
    })

    it('includes llm-proxy in all enabled list regardless of platform', () => {
      const state = makeState({
        platform: 'darwin',
        enabledModules: ['jarvis-llm-proxy-api'],
      })
      const all = getAllEnabledServices(state, registry)
      const ids = all.map((s) => s.id)
      expect(ids).toContain('jarvis-llm-proxy-api')
    })
  })

  describe('GPU service config', () => {
    it('adds nvidia deploy config for llm-proxy on linux', () => {
      const state = makeState({
        platform: 'linux',
        enabledModules: ['jarvis-llm-proxy-api', 'jarvis-tts'],
        hardware: {
          platform: 'linux',
          arch: 'x86_64',
          totalMemoryGb: 32,
          gpuName: 'NVIDIA RTX 3090',
          gpuVramMb: 24576,
          gpuType: 'nvidia',
          recommendedBackends: ['gguf', 'vllm'],
          recommendedBackend: 'gguf',
        },
      })
      const output = generateCompose(state, registry)
      expect(output).toContain('driver: nvidia')
      expect(output).toContain('capabilities: [gpu]')
      expect(output).toContain('ipc: host')
      expect(output).toContain('shm_size: "8gb"')
      expect(output).toContain('.models')
    })

    it('adds vulkan device passthrough for AMD GPU', () => {
      const state = makeState({
        platform: 'linux',
        enabledModules: ['jarvis-llm-proxy-api'],
        hardware: {
          platform: 'linux',
          arch: 'x86_64',
          totalMemoryGb: 32,
          gpuName: 'AMD RX 9070 XT',
          gpuVramMb: 16384,
          gpuType: 'amd',
          recommendedBackends: ['gguf'],
          recommendedBackend: 'gguf',
        },
      })
      const output = generateCompose(state, registry)
      expect(output).toContain('/dev/dri:/dev/dri')
      expect(output).toContain('/dev/kfd:/dev/kfd')
      expect(output).toContain('ipc: host')
      expect(output).not.toContain('driver: nvidia')
    })
  })

  describe('cpuFallback (whisper) GPU variant selection', () => {
    function whisperState(gpuType: 'nvidia' | 'amd' | 'amd-rocm' | 'none' | null, platform: 'linux' | 'darwin' = 'linux') {
      return makeState({
        platform,
        enabledModules: ['jarvis-whisper-api'],
        hardware: gpuType
          ? {
              platform,
              arch: 'x86_64',
              totalMemoryGb: 32,
              gpuName: 'test',
              gpuVramMb: 8192,
              gpuType,
              recommendedBackends: ['gguf'],
              recommendedBackend: 'gguf',
            }
          : null,
      })
    }

    it('uses -cuda variant on NVIDIA hosts', () => {
      const output = generateCompose(whisperState('nvidia'), registry)
      expect(output).toContain('image: ghcr.io/alexberardi/jarvis-whisper-api:${JARVIS_IMAGE_TAG:-latest}-cuda')
      expect(output).toContain('driver: nvidia')
    })

    it('uses -rocm variant on AMD ROCm hosts', () => {
      const output = generateCompose(whisperState('amd-rocm'), registry)
      expect(output).toContain('image: ghcr.io/alexberardi/jarvis-whisper-api:${JARVIS_IMAGE_TAG:-latest}-rocm')
      expect(output).toContain('/dev/dri:/dev/dri')
    })

    it('falls back to plain CPU image on AMD Vulkan hosts (no -vulkan tag published)', () => {
      const output = generateCompose(whisperState('amd'), registry)
      expect(output).toContain('image: ghcr.io/alexberardi/jarvis-whisper-api:${JARVIS_IMAGE_TAG:-latest}')
      expect(output).not.toContain('image: ghcr.io/alexberardi/jarvis-whisper-api:${JARVIS_IMAGE_TAG:-latest}-vulkan')
      // Whisper section should not contain a GPU-runtime block on this host
      const block = output.slice(output.indexOf('jarvis-whisper-api:'))
      const blockEnd = block.search(/\n {2}[a-z][a-z0-9-]*:\n/)
      const whisperOnly = blockEnd > 0 ? block.slice(0, blockEnd) : block
      expect(whisperOnly).not.toContain('driver: nvidia')
      expect(whisperOnly).not.toContain('/dev/kfd')
    })

    it('still emits whisper on macOS (cpuFallback overrides darwin GPU exclusion)', () => {
      const services = getComposeServices(whisperState(null, 'darwin'), registry)
      const ids = services.map((s) => s.id)
      expect(ids).toContain('jarvis-whisper-api')
    })

    it('does NOT mount the models volume on whisper (model is baked into image)', () => {
      const output = generateCompose(whisperState('nvidia'), registry)
      const block = output.slice(output.indexOf('jarvis-whisper-api:'))
      const blockEnd = block.search(/\n {2}[a-z][a-z0-9-]*:\n/)
      const whisperOnly = blockEnd > 0 ? block.slice(0, blockEnd) : block
      expect(whisperOnly).not.toContain('${MODELS_DIR:-./.models}:/app/.models')
    })

    it('mounts whisper-models via WHISPER_MODELS_DIR with relative fallback', () => {
      // Templated so env-generator's WHISPER_MODELS_DIR can swap in the
      // absolute host path under admin-in-docker without changing compose.
      const output = generateCompose(whisperState('nvidia'), registry)
      expect(output).toContain('${WHISPER_MODELS_DIR:-./whisper-models}:/whisper-models:ro')
    })

    it('still mounts models volume on llm-proxy (modelVolume: true)', () => {
      const state = makeState({
        platform: 'linux',
        enabledModules: ['jarvis-llm-proxy-api'],
        hardware: {
          platform: 'linux',
          arch: 'x86_64',
          totalMemoryGb: 32,
          gpuName: 'NVIDIA RTX 3090',
          gpuVramMb: 24576,
          gpuType: 'nvidia',
          recommendedBackends: ['gguf'],
          recommendedBackend: 'gguf',
        },
      })
      const output = generateCompose(state, registry)
      expect(output).toContain('${MODELS_DIR:-./.models}:/app/.models')
    })
  })

  describe('remote-llm mode', () => {
    it('adds remote LLM URL to command-center env', () => {
      const state = makeState({
        deploymentMode: 'remote-llm',
        remoteLlmUrl: 'http://192.168.1.100:7704',
        remoteWhisperUrl: 'http://192.168.1.100:7706',
      })
      const output = generateCompose(state, registry)
      expect(output).toContain('JARVIS_LLM_PROXY_URL: http://192.168.1.100:7704')
      expect(output).toContain('JARVIS_WHISPER_URL: http://192.168.1.100:7706')
    })
  })

  describe('Jarvis Relay', () => {
    it('emits JARVIS_RELAY_URL templated env on command-center when enabled', () => {
      const state = makeState({ relayEnabled: true, relayUrl: 'https://relay.example.com' })
      const output = generateCompose(state, registry)
      // Admin uses .env substitution — the value goes into .env via env-generator;
      // the compose just references the var. See env-generator.test.ts for the value test.
      expect(output).toContain('JARVIS_RELAY_URL: ${JARVIS_RELAY_URL:-}')
    })

    it('omits JARVIS_RELAY_URL on command-center when disabled', () => {
      const state = makeState({ relayEnabled: false })
      const output = generateCompose(state, registry)
      expect(output).not.toContain('JARVIS_RELAY_URL:')
    })

    it('emits RELAY_URL + RELAY_HOUSEHOLD_JWT on jarvis-notifications when enabled', () => {
      const state = makeState({
        relayEnabled: true,
        enabledModules: ['jarvis-notifications'],
      })
      const output = generateCompose(state, registry)
      // Sliced to the notifications block so we don't accidentally match the CC line.
      const notifIdx = output.indexOf('jarvis-notifications:')
      const nextSvcIdx = output.indexOf('\n  jarvis-', notifIdx + 1)
      const notifBlock = output.slice(notifIdx, nextSvcIdx === -1 ? undefined : nextSvcIdx)
      expect(notifBlock).toContain('RELAY_URL: ${JARVIS_RELAY_URL:-}')
      expect(notifBlock).toContain('RELAY_HOUSEHOLD_JWT: ${JARVIS_RELAY_HOUSEHOLD_JWT:-}')
    })

    it('omits RELAY_URL + RELAY_HOUSEHOLD_JWT on jarvis-notifications when disabled', () => {
      const state = makeState({
        relayEnabled: false,
        enabledModules: ['jarvis-notifications'],
      })
      const output = generateCompose(state, registry)
      const notifIdx = output.indexOf('jarvis-notifications:')
      const nextSvcIdx = output.indexOf('\n  jarvis-', notifIdx + 1)
      const notifBlock = output.slice(notifIdx, nextSvcIdx === -1 ? undefined : nextSvcIdx)
      expect(notifBlock).not.toContain('RELAY_URL:')
      expect(notifBlock).not.toContain('RELAY_HOUSEHOLD_JWT:')
    })
  })

  describe('native services on macOS', () => {
    it('excludes opted-in native services from compose on darwin', () => {
      const state = makeState({
        platform: 'darwin',
        enabledModules: ['jarvis-whisper-api', 'jarvis-tts', 'jarvis-llm-proxy-api', 'jarvis-notifications'],
        nativeServices: ['jarvis-whisper-api', 'jarvis-tts', 'jarvis-llm-proxy-api'],
      })
      const ids = getComposeServices(state, registry).map((s) => s.id)
      expect(ids).not.toContain('jarvis-whisper-api')
      expect(ids).not.toContain('jarvis-tts')
      expect(ids).not.toContain('jarvis-llm-proxy-api')
      // Non-native enabled service still in compose
      expect(ids).toContain('jarvis-notifications')
    })

    it('keeps services in compose on darwin when not opted in to native', () => {
      const state = makeState({
        platform: 'darwin',
        enabledModules: ['jarvis-whisper-api', 'jarvis-tts'],
        nativeServices: [],
      })
      const ids = getComposeServices(state, registry).map((s) => s.id)
      // Whisper has cpuFallback so it stays in compose (CPU image) when not opted-in
      expect(ids).toContain('jarvis-whisper-api')
      expect(ids).toContain('jarvis-tts')
    })

    it('ignores nativeServices on linux (Mac-only feature)', () => {
      const state = makeState({
        platform: 'linux',
        enabledModules: ['jarvis-whisper-api', 'jarvis-tts'],
        // Even if the field is populated, linux uses docker for everything
        nativeServices: ['jarvis-whisper-api', 'jarvis-tts'],
      })
      const ids = getComposeServices(state, registry).map((s) => s.id)
      expect(ids).toContain('jarvis-whisper-api')
      expect(ids).toContain('jarvis-tts')
    })
  })

  describe('postgres infrastructure', () => {
    it('includes postgres with healthcheck', () => {
      const state = makeState()
      const output = generateCompose(state, registry)
      expect(output).toContain('postgres:')
      expect(output).toContain('pg_isready')
      expect(output).toContain('init-db.sh')
    })

    it('mounts init-db.sh via INIT_DB_PATH with relative fallback', () => {
      // Templated so env-generator's INIT_DB_PATH can swap in the absolute
      // host path under admin-in-docker without changing compose.
      const output = generateCompose(makeState(), registry)
      expect(output).toContain('${INIT_DB_PATH:-./init-db.sh}:/docker-entrypoint-initdb.d/init-db.sh')
    })
  })

  describe('go2rtc', () => {
    it('mounts go2rtc.yaml via GO2RTC_CONFIG_PATH with relative fallback', () => {
      const state = makeState({ enabledModules: ['go2rtc'] })
      const output = generateCompose(state, registry)
      expect(output).toContain('${GO2RTC_CONFIG_PATH:-./go2rtc.yaml}:/config/go2rtc.yaml')
    })
  })

  describe('worker emission', () => {
    function nvidiaState() {
      return makeState({
        platform: 'linux',
        enabledModules: ['jarvis-llm-proxy-api'],
        hardware: {
          platform: 'linux',
          arch: 'x86_64',
          totalMemoryGb: 32,
          gpuName: 'NVIDIA RTX 3090',
          gpuVramMb: 24576,
          gpuType: 'nvidia',
          recommendedBackends: ['gguf', 'vllm'],
          recommendedBackend: 'gguf',
        },
      })
    }

    it('emits llm-proxy-worker as a sibling service', () => {
      const output = generateCompose(nvidiaState(), registry)
      expect(output).toContain('llm-proxy-worker:')
      expect(output).toContain('container_name: llm-proxy-worker')
    })

    it('worker uses the parent worker command and env override', () => {
      const output = generateCompose(nvidiaState(), registry)
      expect(output).toContain('command: python scripts/queue_worker.py')
      expect(output).toContain('LLM_PROXY_PROCESS_ROLE: worker')
      expect(output).toContain('MODEL_SERVICE_URL: http://jarvis-llm-proxy-api:7705')
    })

    it('worker depends_on parent service healthy', () => {
      const output = generateCompose(nvidiaState(), registry)
      const workerBlock = output.slice(output.indexOf('llm-proxy-worker:'))
      expect(workerBlock).toMatch(/depends_on:[\s\S]*jarvis-llm-proxy-api:\s*\n\s*condition: service_healthy/)
    })

    it('worker inherits parent GPU deploy block', () => {
      const output = generateCompose(nvidiaState(), registry)
      const workerBlock = output.slice(output.indexOf('llm-proxy-worker:'))
      // Worker section ends at the next top-level service or the networks/volumes block
      const workerEnd = workerBlock.search(/\n {2}[a-z][a-z0-9-]*:\n/)
      const workerOnly = workerEnd > 0 ? workerBlock.slice(0, workerEnd) : workerBlock
      expect(workerOnly).toContain('driver: nvidia')
      expect(workerOnly).toContain('capabilities: [gpu]')
      expect(workerOnly).toContain('ipc: host')
    })

    it('worker has no ports and no healthcheck', () => {
      const output = generateCompose(nvidiaState(), registry)
      const workerBlock = output.slice(output.indexOf('llm-proxy-worker:'))
      const workerEnd = workerBlock.search(/\n {2}[a-z][a-z0-9-]*:\n/)
      const workerOnly = workerEnd > 0 ? workerBlock.slice(0, workerEnd) : workerBlock
      expect(workerOnly).not.toContain('ports:')
      expect(workerOnly).not.toContain('healthcheck:')
    })

    it('worker is omitted when parent is excluded (darwin)', () => {
      const state = makeState({
        platform: 'darwin',
        enabledModules: ['jarvis-llm-proxy-api'],
      })
      const output = generateCompose(state, registry)
      expect(output).not.toContain('llm-proxy-worker:')
    })

    it('getComposeWorkerIds enumerates all workers across services', () => {
      const services = getAllEnabledServices(nvidiaState(), registry)
      const ids = getComposeWorkerIds(services)
      expect(ids).toContain('llm-proxy-worker')
    })

    it('getComposeWorkerIds returns empty when no parents have workers', () => {
      const services = getAllEnabledServices(
        makeState({ enabledModules: ['jarvis-tts'] }),
        registry,
      ).filter((s) => s.id !== 'jarvis-llm-proxy-api')
      const ids = getComposeWorkerIds(services)
      expect(ids).toEqual([])
    })
  })

  describe('service-level named volumes', () => {
    it('declares jarvis-tts HF cache volume at top level', () => {
      const state = makeState({ enabledModules: ['jarvis-tts'] })
      const output = generateCompose(state, registry)
      expect(output).toContain('- jarvis-tts-hf-cache:/app/models/hf_cache')
      // The named volume must also be declared in the top-level volumes section
      const volumesBlock = output.slice(output.lastIndexOf('volumes:'))
      expect(volumesBlock).toContain('jarvis-tts-hf-cache:')
    })

    it('does not declare bind-mount paths at top level', () => {
      // jarvis-mcp mounts /var/run/docker.sock — that's a bind mount and should
      // not appear as a top-level volume declaration.
      const state = makeState({ enabledModules: ['jarvis-mcp'] })
      const output = generateCompose(state, registry)
      const volumesBlock = output.slice(output.lastIndexOf('volumes:'))
      expect(volumesBlock).not.toContain('/var/run/docker.sock:')
    })

    it('llm-proxy keeps NVIDIA GPU config even when hardware is null (reconcile case)', () => {
      // Regression for v0.1.33: state-reconstructor returned hardware: null,
      // pushGpuConfig short-circuited, the regenerated compose stripped
      // ipc:host + shm_size + the nvidia deploy block from llm-proxy, the
      // recreated container booted without GPU access, and vLLM crashed.
      const state = makeState({
        platform: 'linux',
        enabledModules: ['jarvis-llm-proxy-api'],
        hardware: null,
      })
      const output = generateCompose(state, registry)
      const start = output.search(/\n {2}jarvis-llm-proxy-api:\n/)
      const block = output.slice(start + 1)
      const blockEnd = block.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/)
      const llmProxy = blockEnd > 0 ? block.slice(0, blockEnd + 1) : block
      expect(llmProxy).toContain('ipc: host')
      expect(llmProxy).toContain('shm_size: "8gb"')
      expect(llmProxy).toContain('driver: nvidia')
      expect(llmProxy).toContain('capabilities: [gpu]')
    })

    it('does not declare ${VAR}-prefixed host paths at top level', () => {
      // jarvis-admin mounts ${HOME}/.jarvis/compose:/host/compose — that's a
      // host path with an env-var prefix; previously the named-volume filter
      // only rejected leading / and ., letting this leak into the top-level
      // volumes: section and triggering "additional properties not allowed".
      const state = makeState({ enabledModules: ['jarvis-admin'] })
      const output = generateCompose(state, registry)
      const volumesBlock = output.slice(output.lastIndexOf('volumes:'))
      expect(volumesBlock).not.toContain('${HOME}')
    })
  })

  describe('migration entrypoint wrapper', () => {
    // Every service the registry marks `migrate: true` must get the
    // alembic-then-exec entrypoint wrapper so it runs `alembic upgrade head`
    // before serving. Driven by the registry flag — no service-id hardcoding.
    const MIGRATE_SET = registry.services
      .filter((s) => s.migrate)
      .map((s) => s.id)

    // Slice the compose output to a single service's block.
    function serviceBlock(output: string, id: string): string {
      const start = output.indexOf(`\n  ${id}:\n`)
      expect(start, `${id} missing from compose`).toBeGreaterThanOrEqual(0)
      const after = output.slice(start + `\n  ${id}:\n`.length)
      const next = after.match(/\n {2}[a-z][a-z0-9-]*:\n/)
      return next ? after.slice(0, next.index) : after
    }

    // Enable every recommended/optional migrate-set service so they all emit.
    const allMigrateState = makeState({
      platform: 'linux',
      enabledModules: MIGRATE_SET,
      hardware: {
        platform: 'linux',
        arch: 'x86_64',
        totalMemoryGb: 32,
        gpuName: 'NVIDIA RTX 3090',
        gpuVramMb: 24576,
        gpuType: 'nvidia',
        recommendedBackends: ['gguf'],
        recommendedBackend: 'gguf',
      },
    })

    it('marks the expected services as migrate-set in the registry', () => {
      // Regression guard: config-service (the one that 500'd) and the other
      // DB-backed services must carry the flag. logs/tts are intentionally
      // deferred — their images don't ship alembic and their prod DBs are
      // un-stamped, so they need separate wiring before they can auto-migrate.
      expect(MIGRATE_SET).toEqual(
        expect.arrayContaining([
          'jarvis-config-service',
          'jarvis-auth',
          'jarvis-command-center',
          'jarvis-whisper-api',
          'jarvis-llm-proxy-api',
          'jarvis-notifications',
        ]),
      )
      expect(MIGRATE_SET).not.toContain('jarvis-logs')
      expect(MIGRATE_SET).not.toContain('jarvis-tts')
    })

    it.each(MIGRATE_SET)('emits the alembic entrypoint wrapper for %s', (id) => {
      const output = generateCompose(allMigrateState, registry)
      const block = serviceBlock(output, id)
      expect(block).toContain('entrypoint:')
      expect(block).toContain('- /bin/sh')
      expect(block).toContain('- -c')
      expect(block).toContain('- python -m alembic upgrade head && exec "$@"')
      expect(block).toContain('- jarvis-migrate')
    })

    it('does NOT emit a migrate entrypoint for non-migrate services (jarvis-web)', () => {
      const output = generateCompose(makeState({ enabledModules: ['jarvis-web'] }), registry)
      const block = serviceBlock(output, 'jarvis-web')
      expect(block).not.toContain('alembic upgrade head')
      expect(block).not.toContain('entrypoint:')
    })

    it('keeps an explicit serve command on migrate services with no seed (overriding entrypoint clears image CMD)', () => {
      const output = generateCompose(allMigrateState, registry)
      const cc = serviceBlock(output, 'jarvis-command-center')
      const whisper = serviceBlock(output, 'jarvis-whisper-api')
      // Overriding `entrypoint` CLEARS the image CMD — so the migrate wrapper's
      // `exec "$@"` has nothing to run unless these carry a command. Without it
      // they exit right after migrating (restart-loop, no server).
      expect(cc).toContain('    command:')
      expect(cc).toContain('"uvicorn", "app.main:app"')
      expect(whisper).toContain('    command:')
      expect(whisper).toContain('"uvicorn", "app.main:app"')
    })

    it('INVARIANT: every migrate service emits a non-empty command (no exec "" exit)', () => {
      // Generic class guard — unlike a per-service test, this can't be written to
      // encode the bug. Any migrate service that overrides entrypoint MUST supply
      // a command, or `exec "$@"` runs nothing and the container exits.
      const output = generateCompose(allMigrateState, registry)
      const offenders = MIGRATE_SET.filter((id) => {
        const block = serviceBlock(output, id)
        return block.includes('exec "$@"') && !/\n {4}command:/.test(block)
      })
      expect(
        offenders,
        `migrate services with entrypoint but NO command (exec "" → exit): ${offenders.join(', ')}`,
      ).toEqual([])
    })

    it('llm-proxy keeps a dual-uvicorn command WITHOUT the alembic prefix (no image CMD)', () => {
      const output = generateCompose(allMigrateState, registry)
      const llm = serviceBlock(output, 'jarvis-llm-proxy-api')
      // Entrypoint migrates; the command starts both uvicorn processes.
      expect(llm).toContain('entrypoint:')
      expect(llm).toContain('    command:')
      expect(llm).toContain('uvicorn services.model_service:app')
      expect(llm).toContain('uvicorn main:app')
      // The command itself must not re-run migrations (the entrypoint does that).
      expect(llm).not.toContain('command: ["sh", "-c", "python -m alembic')
    })

    it('jarvis-auth serves jarvis_auth.app.main:app, NOT the generic app.main:app', () => {
      // auth is the one migrate service whose app is packaged under `jarvis_auth.`
      // rather than at top-level `app.main`. The generic `app.main:app` crash-loops
      // it with `ModuleNotFoundError: No module named 'app'`, so it never serves
      // /health (the bug that kept the install-e2e sync-live lane red).
      const output = generateCompose(allMigrateState, registry)
      const auth = serviceBlock(output, 'jarvis-auth')
      expect(auth).toContain('    command:')
      expect(auth).toContain('"uvicorn", "jarvis_auth.app.main:app"')
      expect(auth).not.toContain('"uvicorn", "app.main:app"')
    })
  })

  describe('command-center prompt-provider volume', () => {
    it('emits the prompt-providers mount under jarvis-command-center', () => {
      const state = makeState({ enabledModules: [] })
      const output = generateCompose(state, registry)
      expect(output).toContain(
        '- command-center-prompt-providers:/app/core/prompt_providers_custom',
      )
      const ccStart = output.indexOf('  jarvis-command-center:\n')
      expect(ccStart).toBeGreaterThanOrEqual(0)
      const afterCc = output.slice(ccStart + '  jarvis-command-center:\n'.length)
      const nextSvcMatch = afterCc.match(/\n {2}[a-z][a-z0-9-]*:\n/)
      const ccBlock = nextSvcMatch
        ? afterCc.slice(0, nextSvcMatch.index)
        : afterCc
      expect(ccBlock).toContain(
        'command-center-prompt-providers:/app/core/prompt_providers_custom',
      )
    })

    it('declares command-center-prompt-providers in the top-level volumes block', () => {
      const state = makeState({ enabledModules: [] })
      const output = generateCompose(state, registry)
      const volumesBlock = output.slice(output.lastIndexOf('volumes:'))
      expect(volumesBlock).toContain('command-center-prompt-providers:')
    })

    it('keeps emitting existing service volumes (regression: whisper-voice-profiles, jarvis-tts-hf-cache)', () => {
      const state = makeState({
        enabledModules: ['jarvis-whisper-api', 'jarvis-tts'],
      })
      const output = generateCompose(state, registry)
      expect(output).toContain('- whisper-voice-profiles:/app/voice_profiles')
      expect(output).toContain('- jarvis-tts-hf-cache:/app/models/hf_cache')
      const volumesBlock = output.slice(output.lastIndexOf('volumes:'))
      expect(volumesBlock).toContain('whisper-voice-profiles:')
      expect(volumesBlock).toContain('jarvis-tts-hf-cache:')
    })
  })
})

describe('compose-generator: pinned project name', () => {
  const registry = loadRegistry()
  it('pins the Compose project name (name: jarvis) above services:', () => {
    const output = generateCompose(makeState(), registry)
    expect(output).toContain('name: jarvis')
    // must be a top-level key, before services:
    expect(output.indexOf('name: jarvis')).toBeGreaterThanOrEqual(0)
    expect(output.indexOf('name: jarvis')).toBeLessThan(output.indexOf('services:'))
  })
})

describe('dockerized URL style', () => {
  it('emits JARVIS_CONFIG_URL_STYLE=dockerized for services so localhost broker resolves', () => {
    const output = generateCompose(makeState({ enabledModules: ['jarvis-notifications'] }), loadRegistry())
    // lets a localhost-registered broker resolve to host.docker.internal for in-Docker
    // services while remote nodes resolve it to the server IP
    expect(output).toContain('JARVIS_CONFIG_URL_STYLE: "dockerized"')
  })
})
