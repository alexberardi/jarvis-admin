import { describe, it, expect } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateCompose } from '../../src/services/generators/compose-generator.js'
import { parseRegistry } from '../../src/services/generators/service-registry.js'
import type { ServiceRegistry } from '../../src/types/service-registry.js'
import type { WizardState } from '../../src/types/wizard.js'

// MinIO deleted its Docker Hub repositories. Two nightlies died of it:
//
//   2026-09-11  minio-init is 'running', expected it to have run and exited
//   2026-09-12  pull access denied for minio/mc, repository does not exist
//
// The 11th is the instructive one -- the images still pulled, but a new :latest
// changed behaviour and the bucket one-shot looped forever. The 12th they were
// gone. Same root cause: an unpinned tag from a registry we do not control. So
// this pins the registry AND the version.

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

const minioImages = () => {
  const registry = loadRegistry()
  const doc = parseYaml(generateCompose(makeState(), registry)) as {
    services: Record<string, { image?: string }>
  }
  return Object.entries(doc.services)
    .filter(([id]) => id.startsWith('minio'))
    .map(([id, svc]) => [id, svc.image ?? ''] as const)
}

describe('the minio images', () => {
  it('emits minio services at all', () => {
    expect(minioImages().length).toBeGreaterThan(0)
  })

  it('never pulls minio from Docker Hub', () => {
    for (const [id, image] of minioImages()) {
      // A bare "minio/minio" resolves to Docker Hub, where the repository no
      // longer exists.
      expect(image, `${id} has no image`).toBeTruthy()
      expect(image.startsWith('quay.io/'), `${id} pulls ${image}`).toBe(true)
    }
  })

  it('pins a release rather than following :latest', () => {
    for (const [id, image] of minioImages()) {
      expect(image.endsWith(':latest'), `${id} follows :latest`).toBe(false)
      expect(image, `${id} is not pinned to a release`).toMatch(/:RELEASE\.[\d-]+T/)
    }
  })

  it("the registry's minio entry names quay.io with a pinned release", () => {
    const minio = loadRegistry().infrastructure.find((i) => i.id === 'minio')
    expect(minio).toBeTruthy()
    expect(minio.image).toMatch(/^quay\.io\/minio\/minio:RELEASE\./)
  })
})
