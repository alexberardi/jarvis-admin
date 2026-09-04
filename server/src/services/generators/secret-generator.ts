import { generateKeyPairSync, randomBytes } from 'node:crypto'

/**
 * Generates a cryptographically secure hex string using Node.js crypto.
 */
export function generateHexSecret(byteLength: number = 32): string {
  return randomBytes(byteLength).toString('hex')
}

/**
 * RSA keypair for jarvis-auth's RS256 signing, returned as a base64-encoded
 * PKCS#8 PEM.
 *
 * Base64 because a raw PEM is multi-line and .env / docker-compose env blocks
 * mangle those. Only the private half is emitted: jarvis-auth derives the public
 * key from it and publishes it at /auth/public-key, so the two can never drift.
 *
 * 2048-bit: the tokens live 30 minutes and the key is a local-network signing
 * key, so 4096 buys nothing but slower installs on small nodes.
 */
export function generateRsaPrivateKeyB64(): string {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  return Buffer.from(privateKey).toString('base64')
}

/**
 * Secrets that are NOT flat hex strings and need their own generator. Kept in
 * SECRET_KEYS as well, so the upgrade paths (env-merger, state-reconstructor)
 * preserve them across an upgrade — regenerating this one would invalidate every
 * RS256 token in the fleet and strand verifiers that cache the public key.
 */
export const KEYPAIR_SECRET_KEYS: readonly string[] = ['AUTH_PRIVATE_KEY']

export function generateSecretFor(key: string): string {
  if (KEYPAIR_SECRET_KEYS.includes(key)) return generateRsaPrivateKeyB64()
  return generateHexSecret(key.includes('PASSWORD') ? 16 : 32)
}

export const SECRET_KEYS = [
  'AUTH_SECRET_KEY',
  'JARVIS_CONFIG_ADMIN_TOKEN',
  'JARVIS_AUTH_ADMIN_TOKEN',
  'POSTGRES_PASSWORD',
  'REDIS_PASSWORD',
  'ADMIN_API_KEY',
  // Internal auth between the llm-proxy API/worker and its model service (:7705).
  // The model service 503s ALL inference when this is unset (while /health stays
  // green), so it must be generated + injected on every install. No 'PASSWORD' in
  // the name -> 32 bytes / 64 hex, matching the installer.
  'MODEL_SERVICE_TOKEN',
  // Shared MQTT broker credential (username is the literal 'jarvis'). The
  // mosquitto container hashes this into a password_file at startup; every MQTT
  // client (command-center, nodes) authenticates with it. 'PASSWORD' in the name
  // -> 16 bytes / 32 hex. Preserved across regen so nodes keep authenticating.
  'MQTT_PASSWORD',
  // Grafana admin password. Without this the registry default was the well-known
  // literal 'jarvis' on a 0.0.0.0:3000 bind — any LAN client could log in and read
  // all Loki logs (voice transcripts / PII) + SSRF-pivot via the datasource proxy.
  // 'PASSWORD' in the name -> 16 bytes / 32 hex.
  'GRAFANA_ADMIN_PASSWORD',
  // CC-internal auth for async-job result callbacks (memory extraction, deep
  // research, characterization synthesis, adapter training). CC attaches it at
  // enqueue and validates it at the /…/callback endpoints (main.py:1714-1742,
  // FAIL-CLOSED): unset -> every callback 503s and the persist step never runs
  // (save_memory, transcript mark_processed, inbox delivery). Was unset on prod
  // -> passive memory extraction silently dead 2026-06-17..2026-08-07. Same
  // treatment as MODEL_SERVICE_TOKEN: no 'PASSWORD' in the name -> 32 bytes / 64 hex.
  'JARVIS_ADAPTER_CALLBACK_TOKEN',
  // RSA private key for jarvis-auth's RS256 signing (base64 PKCS#8 PEM, NOT hex
  // — see generateSecretFor). Listed here so the upgrade paths preserve it.
  'AUTH_PRIVATE_KEY',
] as const

export type SecretKey = (typeof SECRET_KEYS)[number]

/**
 * Generates all required secrets.
 * Passwords get 16 bytes (32 hex chars), auth secrets get 32 bytes (64 hex chars).
 */
export function generateAllSecrets(): Record<SecretKey, string> {
  const secrets: Record<string, string> = {}
  for (const key of SECRET_KEYS) {
    secrets[key] = generateSecretFor(key)
  }
  return secrets as Record<SecretKey, string>
}
