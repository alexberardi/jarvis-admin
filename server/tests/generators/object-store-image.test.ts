// Replaces minio-image.test.ts. MinIO deleted its Docker Hub repositories, then
// archived the whole OSS project and closed every remaining channel. Three
// nightlies died of it, all the same root cause -- a MOVING reference into a
// registry we do not control -- so this pins the strongest thing available: a
// digest, which cannot be repointed the way a tag can.
//
// See prds/minio-eol-object-store.md.
import { describe, it, expect } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateCompose } from '../../src/services/generators/compose-generator.js'
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
    enabledModules: ['jarvis-recipes-server', 'jarvis-ocr-service'],
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

const objectStoreImages = () => {
  const registry = loadRegistry()
  const doc = parseYaml(generateCompose(makeState(), registry)) as {
    services: Record<string, { image?: string }>
  }
  return Object.entries(doc.services)
    .filter(([id]) => id.startsWith('seaweedfs'))
    .map(([id, svc]) => [id, svc.image ?? ''] as const)
}

describe('the object store images', () => {
  it('emits object store services at all', () => {
    expect(objectStoreImages().length).toBeGreaterThan(0)
  })

  it('pins by digest rather than a moving tag', () => {
    for (const [id, image] of objectStoreImages()) {
      expect(image, `${id} has no image`).toBeTruthy()
      expect(image.endsWith(':latest'), `${id} follows :latest`).toBe(false)
      // The whole lesson of the MinIO outage in one assertion: a tag can be
      // repointed, a digest cannot.
      expect(image, `${id} is not digest-pinned: ${image}`).toMatch(/@sha256:[0-9a-f]{64}$/)
    }
  })

  it('runs the init one-shot on the same image as the store', () => {
    // Two images meant two ways to lose the object store -- `mc` disappeared a
    // day after the server did. `weed shell` ships in the server image, so
    // there is exactly one reference to keep alive now.
    const images = new Set(objectStoreImages().map(([, image]) => image))
    expect(images.size, `expected one image, got ${[...images].join(', ')}`).toBe(1)
  })
})

describe("the registry's object store entry", () => {
  it('is SeaweedFS, pinned by digest', () => {
    const store = loadRegistry().infrastructure.find((i) => i.id === 'seaweedfs')
    expect(store).toBeTruthy()
    expect(store!.image).toMatch(/^chrislusf\/seaweedfs@sha256:[0-9a-f]{64}$/)
  })

  it('no longer carries a MinIO entry', () => {
    const ids = loadRegistry().infrastructure.map((i) => i.id)
    expect(ids).not.toContain('minio')
  })
})
