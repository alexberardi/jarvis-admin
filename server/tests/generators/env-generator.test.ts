import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateEnv } from '../../src/services/generators/env-generator.js'
import { parseRegistry } from '../../src/services/generators/service-registry.js'
import { generateAllSecrets, SECRET_KEYS } from '../../src/services/generators/secret-generator.js'
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
    secrets: generateAllSecrets(),
    dbUser: 'jarvis',
    whisperModel: 'base.en',
    llmInterface: 'JarvisToolModel',
    deploymentMode: 'local',
    deploymentTarget: 'standard',
    remoteLlmUrl: '',
    remoteWhisperUrl: '',
    platform: 'linux',
    hardware: null,
    relayEnabled: false,
    relayUrl: '',
    ...overrides,
  }
}

describe('env-generator', () => {
  const registry = loadRegistry()

  it('includes all secret keys', () => {
    const state = makeState()
    const output = generateEnv(state, registry)
    for (const key of SECRET_KEYS) {
      expect(output).toContain(`${key}=`)
    }
  })

  it('includes DB_USER', () => {
    const state = makeState({ dbUser: 'testuser' })
    const output = generateEnv(state, registry)
    expect(output).toContain('DB_USER=testuser')
  })

  it('includes service port variables', () => {
    const state = makeState()
    const output = generateEnv(state, registry)
    expect(output).toContain('CONFIG_SERVICE_PORT=7700')
    expect(output).toContain('AUTH_PORT=7701')
    expect(output).toContain('LOGS_PORT=7702')
    expect(output).toContain('COMMAND_CENTER_PORT=7703')
  })

  it('applies port overrides', () => {
    const state = makeState({
      portOverrides: { 'jarvis-auth': 8888 },
    })
    const output = generateEnv(state, registry)
    expect(output).toContain('AUTH_PORT=8888')
  })

  it('includes infrastructure ports', () => {
    const state = makeState()
    const output = generateEnv(state, registry)
    expect(output).toContain('POSTGRES_PORT=5432')
    expect(output).toContain('REDIS_PORT=6379')
  })

  it('includes app-to-app auth placeholders', () => {
    const state = makeState()
    const output = generateEnv(state, registry)
    expect(output).toContain('JARVIS_APP_ID_AUTH=')
    expect(output).toContain('JARVIS_APP_KEY_AUTH=')
  })

  describe('remote-llm mode', () => {
    it('includes remote URLs', () => {
      const state = makeState({
        deploymentMode: 'remote-llm',
        remoteLlmUrl: 'http://192.168.1.100:7704',
        remoteWhisperUrl: 'http://192.168.1.100:7706',
      })
      const output = generateEnv(state, registry)
      expect(output).toContain('JARVIS_LLM_PROXY_URL=http://192.168.1.100:7704')
      expect(output).toContain('JARVIS_WHISPER_URL=http://192.168.1.100:7706')
    })

    it('omits remote URLs in local mode', () => {
      const state = makeState({ deploymentMode: 'local' })
      const output = generateEnv(state, registry)
      expect(output).not.toContain('JARVIS_LLM_PROXY_URL=')
      expect(output).not.toContain('JARVIS_WHISPER_URL=')
    })
  })

  describe('Jarvis Relay', () => {
    it('writes JARVIS_RELAY_URL with default when enabled and no custom URL', () => {
      const state = makeState({ relayEnabled: true, relayUrl: '' })
      const output = generateEnv(state, registry)
      expect(output).toContain('JARVIS_RELAY_URL=https://relay.jarvisautomation.io')
    })

    it('writes JARVIS_RELAY_URL with custom value when provided', () => {
      const state = makeState({ relayEnabled: true, relayUrl: 'https://relay.example.com' })
      const output = generateEnv(state, registry)
      expect(output).toContain('JARVIS_RELAY_URL=https://relay.example.com')
    })

    it('omits JARVIS_RELAY_URL entirely when relayEnabled is false', () => {
      const state = makeState({ relayEnabled: false, relayUrl: 'https://relay.example.com' })
      const output = generateEnv(state, registry)
      expect(output).not.toContain('JARVIS_RELAY_URL=')
    })
  })
})
