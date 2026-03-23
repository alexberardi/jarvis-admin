import { randomBytes } from 'node:crypto'

/**
 * Generates a cryptographically secure hex string using Node.js crypto.
 */
export function generateHexSecret(byteLength: number = 32): string {
  return randomBytes(byteLength).toString('hex')
}

export const SECRET_KEYS = [
  'AUTH_SECRET_KEY',
  'JARVIS_CONFIG_ADMIN_TOKEN',
  'JARVIS_AUTH_ADMIN_TOKEN',
  'POSTGRES_PASSWORD',
  'REDIS_PASSWORD',
  'ADMIN_API_KEY',
] as const

export type SecretKey = (typeof SECRET_KEYS)[number]

/**
 * Generates all required secrets.
 * Passwords get 16 bytes (32 hex chars), auth secrets get 32 bytes (64 hex chars).
 */
export function generateAllSecrets(): Record<SecretKey, string> {
  const secrets: Record<string, string> = {}
  for (const key of SECRET_KEYS) {
    const byteLength = key.includes('PASSWORD') ? 16 : 32
    secrets[key] = generateHexSecret(byteLength)
  }
  return secrets as Record<SecretKey, string>
}
