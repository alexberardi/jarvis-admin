import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto'

// DER SubjectPublicKeyInfo prefix for an Ed25519 key — prepended to the raw
// 32-byte public key so Node's crypto can build a KeyObject from it.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/**
 * Raw 32-byte Ed25519 key from a minisign public key (the base64 second line of
 * a `.pub`, or the bare base64). `null` if malformed.
 *
 * Layout: `[2-byte algo 'Ed'][8-byte key id][32-byte ed25519 pubkey]` = 42 bytes.
 */
function parsePublicKey(publicKeyB64: string): Buffer | null {
  let raw: Buffer
  try {
    raw = Buffer.from(publicKeyB64.trim(), 'base64')
  } catch {
    return null
  }
  if (raw.length !== 42 || raw[0] !== 0x45 || raw[1] !== 0x64) return null // 'Ed'
  return raw.subarray(10, 42)
}

/**
 * Parse a `.minisig` file's signature line → `{ prehashed, sig }`, or `null`.
 *
 * Layout of the (base64) 2nd line: `[2-byte algo][8-byte key id][64-byte sig]`.
 * algo `ED` (0x45,0x44) = prehashed (Ed25519 over BLAKE2b-512 of the file);
 * `Ed` (0x45,0x64) = legacy (Ed25519 over the file bytes).
 */
function parseSignature(minisigContent: string): { prehashed: boolean; sig: Buffer } | null {
  const lines = minisigContent.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return null
  let raw: Buffer
  try {
    raw = Buffer.from(lines[1], 'base64')
  } catch {
    return null
  }
  if (raw.length !== 74 || raw[0] !== 0x45) return null
  const mode = raw[1]
  if (mode !== 0x44 && mode !== 0x64) return null
  return { prehashed: mode === 0x44, sig: raw.subarray(10, 74) }
}

/**
 * Verify a minisign signature over `artifact` against `publicKeyB64` (the base64
 * line of a minisign public key). Returns true ONLY for a valid signature by
 * that key. Supports minisign's prehashed (BLAKE2b-512) and legacy modes.
 * In-language (Node crypto) — no `minisign` binary dependency.
 */
export function verifyMinisign(publicKeyB64: string, minisigContent: string, artifact: Buffer): boolean {
  const pub = parsePublicKey(publicKeyB64)
  const parsed = parseSignature(minisigContent)
  if (!pub || !parsed) return false

  const message = parsed.prehashed
    ? createHash('blake2b512').update(artifact).digest()
    : artifact

  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, pub]),
      format: 'der',
      type: 'spki',
    })
    return cryptoVerify(null, message, key, parsed.sig)
  } catch {
    return false
  }
}
