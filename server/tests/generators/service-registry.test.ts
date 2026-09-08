import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseRegistry,
  getCoreServices,
  getRecommendedServices,
  getOptionalServices,
  getServiceById,
  getRequiredInfrastructure,
} from '../../src/services/generators/service-registry.js'
import type { ServiceRegistry } from '../../src/types/service-registry.js'

function loadRegistry(): ServiceRegistry {
  const raw = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../src/data/service-registry.json'), 'utf-8'),
  )
  return parseRegistry(raw)
}

describe('service-registry', () => {
  const registry = loadRegistry()

  it('parses the registry JSON', () => {
    expect(registry.version).toBe('3.0.0')
    expect(registry.services.length).toBeGreaterThan(0)
    expect(registry.infrastructure.length).toBeGreaterThan(0)
  })

  it('identifies core services', () => {
    const core = getCoreServices(registry)
    const ids = core.map((s) => s.id)
    expect(ids).toContain('jarvis-config-service')
    expect(ids).toContain('jarvis-auth')
    expect(ids).toContain('jarvis-logs')
    expect(ids).toContain('jarvis-command-center')
    expect(ids).toContain('jarvis-admin')
  })

  it('identifies recommended services', () => {
    const recommended = getRecommendedServices(registry)
    const ids = recommended.map((s) => s.id)
    expect(ids).toContain('jarvis-whisper-api')
    expect(ids).toContain('jarvis-tts')
    expect(ids).toContain('jarvis-llm-proxy-api')
    expect(ids).toContain('jarvis-notifications')
    expect(ids).toContain('jarvis-settings-server')
  })

  it('identifies optional services', () => {
    const optional = getOptionalServices(registry)
    const ids = optional.map((s) => s.id)
    expect(ids).toContain('jarvis-web')
    // jarvis-admin is now core (always installed), not optional
    expect(ids).not.toContain('jarvis-admin')
  })

  it('finds services by ID', () => {
    const auth = getServiceById(registry, 'jarvis-auth')
    expect(auth).toBeDefined()
    expect(auth!.port).toBe(7701)

    const missing = getServiceById(registry, 'nonexistent')
    expect(missing).toBeUndefined()
  })

  it('resolves required infrastructure', () => {
    const infra = getRequiredInfrastructure(registry, ['jarvis-auth', 'jarvis-logs'])
    const ids = infra.map((i) => i.id)
    expect(ids).toContain('postgres')
    expect(ids).toContain('loki')
  })

  it('llm-proxy is marked as GPU service', () => {
    const llm = getServiceById(registry, 'jarvis-llm-proxy-api')
    expect(llm).toBeDefined()
    expect(llm!.gpu).toBe(true)
  })

  // Both were dropped from this registry in e52423d (March 2026, the installer
  // wizard work) and a test kept them out. They are back deliberately: they now
  // ship images, are registered in jarvis-installer, and are covered by
  // install-e2e. Optional, so an install that does not want them is unchanged.
  it('offers recipes and OCR as optional services', () => {
    for (const id of ['jarvis-recipes-server', 'jarvis-ocr-service']) {
      const service = getServiceById(registry, id)
      expect(service, `${id} missing from the registry`).toBeDefined()
      expect(service!.category).toBe('optional')
    }
  })

  it('recipes declares the object store it stores images in', () => {
    // The dependency is not decoration: photo import uploads to MinIO and hands
    // the OCR worker an s3:// URI. Without it the feature is visible in the app
    // and broken in practice.
    const recipes = getServiceById(registry, 'jarvis-recipes-server')
    expect(recipes!.dependsOn).toContain('minio')
    expect(recipes!.objectStore?.bucket).toBeTruthy()
  })
})
