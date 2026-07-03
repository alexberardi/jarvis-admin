import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { verifyMinisign } from '../../src/services/upgrade/minisign.js'

// Fixtures were produced by the REAL `minisign` binary (see how they were
// generated in the PR): a signer keypair signs checksums.txt; a tampered copy
// keeps the signature but changes the bytes; wrong.pub is an unrelated key.
const DIR = join(import.meta.dirname, '../fixtures/minisign')
const read = (f: string) => readFileSync(join(DIR, f))
const readText = (f: string) => readFileSync(join(DIR, f), 'utf-8')
const pubLine = (f: string) => readText(f).split('\n')[1].trim() // base64 line of a .pub

describe('verifyMinisign', () => {
  const signerPub = pubLine('signer.pub')
  const wrongPub = pubLine('wrong.pub')

  it('accepts a genuine signature by the trusted key', () => {
    expect(verifyMinisign(signerPub, readText('checksums.txt.minisig'), read('checksums.txt'))).toBe(true)
  })

  it('rejects a tampered artifact (same signature, changed bytes)', () => {
    expect(
      verifyMinisign(signerPub, readText('checksums.tampered.txt.minisig'), read('checksums.tampered.txt')),
    ).toBe(false)
  })

  it('rejects a valid signature verified against the WRONG public key', () => {
    expect(verifyMinisign(wrongPub, readText('checksums.txt.minisig'), read('checksums.txt'))).toBe(false)
  })

  it('rejects a malformed public key', () => {
    expect(verifyMinisign('not-base64!!', readText('checksums.txt.minisig'), read('checksums.txt'))).toBe(false)
    expect(verifyMinisign('', readText('checksums.txt.minisig'), read('checksums.txt'))).toBe(false)
  })

  it('rejects a malformed / empty signature file', () => {
    expect(verifyMinisign(signerPub, 'garbage', read('checksums.txt'))).toBe(false)
    expect(verifyMinisign(signerPub, '', read('checksums.txt'))).toBe(false)
  })
})
