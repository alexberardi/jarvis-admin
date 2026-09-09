import { describe, it, expect } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateCompose } from '../../src/services/generators/compose-generator.js'
import { parseRegistry } from '../../src/services/generators/service-registry.js'
import type { ServiceRegistry } from '../../src/types/service-registry.js'
import type { WizardState } from '../../src/types/wizard.js'

// A `migrate: true` service gets an entrypoint that migrates then execs "$@".
// Overriding entrypoint clears the image CMD, so the generator must supply the
// serve command -- and it must be the RIGHT one. Two ways this has broken in
// production:
//
//   no command at all   -> exec "" and the container exits after migrating
//   wrong module path   -> ModuleNotFoundError: No module named 'app'
//
// The second shipped to prod because the generator inferred the command from an
// if-chain of service ids and handed everything it did not name `app.main:app`.
// jarvis-recipes-server packages its app at `jarvis_recipes.app.main`.

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
    enabledModules: [],
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

describe('migrate services declare their own serve command', () => {
  const registry = loadRegistry()
  const migrateServices = registry.services.filter((s) => s.migrate)

  it('has migrate services to check', () => {
    expect(migrateServices.length).toBeGreaterThan(0)
  })

  it.each(migrateServices.map((s) => s.id))(
    '%s declares a non-empty serveCommand',
    (id) => {
      const service = registry.services.find((s) => s.id === id)!
      expect(service.serveCommand?.length).toBeGreaterThan(0)
    },
  )

  it('refuses to generate a migrate service with no serveCommand', () => {
    const broken = structuredClone(registry)
    const victim = broken.services.find((s) => s.migrate)!
    delete victim.serveCommand

    // Failing loudly at generation beats emitting a compose file whose
    // container exits immediately after migrating.
    expect(() => generateCompose(makeState(), broken)).toThrow(/serveCommand/)
  })

  it('every emitted migrate service has a command', () => {
    const state = makeState({ enabledModules: migrateServices.map((s) => s.id) })
    const compose = parseYaml(generateCompose(state, registry))

    const emitted = migrateServices.filter((s) => compose.services[s.id])
    expect(emitted.length).toBeGreaterThan(0)

    for (const service of emitted) {
      const block = compose.services[service.id]
      expect(block.entrypoint, `${service.id} should migrate on start`).toBeDefined()
      expect(block.command, `${service.id} would exec "" and exit`).toBeTruthy()
      expect(block.command.length).toBeGreaterThan(0)
    }
  })

  it('serves recipes-server from jarvis_recipes.app.main, not app.main', () => {
    const state = makeState({ enabledModules: ['jarvis-recipes-server'] })
    const compose = parseYaml(generateCompose(state, registry))
    const command: string[] = compose.services['jarvis-recipes-server'].command

    expect(command).toContain('jarvis_recipes.app.main:app')
    expect(command).not.toContain('app.main:app')
  })

  it('substitutes the container port into the serve command', () => {
    const state = makeState({ enabledModules: ['jarvis-recipes-server'] })
    const compose = parseYaml(generateCompose(state, registry))
    const command: string[] = compose.services['jarvis-recipes-server'].command

    expect(command.join(' ')).not.toContain('{{CONTAINER_PORT}}')
    const port = registry.services.find((s) => s.id === 'jarvis-recipes-server')!.port
    expect(command).toContain(String(port))
  })
})
