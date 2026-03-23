import { describe, it, expect } from 'vitest'
import { generateHexSecret, generateAllSecrets, SECRET_KEYS } from '../../src/services/generators/secret-generator.js'

describe('secret-generator', () => {
  describe('generateHexSecret', () => {
    it('generates a hex string of the expected length', () => {
      const secret = generateHexSecret(16)
      expect(secret).toHaveLength(32) // 16 bytes = 32 hex chars
    })

    it('defaults to 32 bytes (64 hex chars)', () => {
      const secret = generateHexSecret()
      expect(secret).toHaveLength(64)
    })

    it('generates unique values', () => {
      const a = generateHexSecret()
      const b = generateHexSecret()
      expect(a).not.toBe(b)
    })

    it('only contains hex characters', () => {
      const secret = generateHexSecret()
      expect(secret).toMatch(/^[0-9a-f]+$/)
    })
  })

  describe('generateAllSecrets', () => {
    it('generates all required secret keys', () => {
      const secrets = generateAllSecrets()
      for (const key of SECRET_KEYS) {
        expect(secrets[key]).toBeDefined()
        expect(secrets[key].length).toBeGreaterThan(0)
      }
    })

    it('uses 32 hex chars for passwords, 64 for auth secrets', () => {
      const secrets = generateAllSecrets()
      expect(secrets.POSTGRES_PASSWORD).toHaveLength(32)
      expect(secrets.REDIS_PASSWORD).toHaveLength(32)
      expect(secrets.AUTH_SECRET_KEY).toHaveLength(64)
      expect(secrets.JARVIS_CONFIG_ADMIN_TOKEN).toHaveLength(64)
    })
  })
})
