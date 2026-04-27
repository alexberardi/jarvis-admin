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
    llmInterface: 'JarvisToolModel',
    deploymentMode: 'local',
    remoteLlmUrl: '',
    remoteWhisperUrl: '',
    platform: 'linux',
    hardware: null,
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

  describe('postgres infrastructure', () => {
    it('includes postgres with healthcheck', () => {
      const state = makeState()
      const output = generateCompose(state, registry)
      expect(output).toContain('postgres:')
      expect(output).toContain('pg_isready')
      expect(output).toContain('init-db.sh')
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
  })
})
