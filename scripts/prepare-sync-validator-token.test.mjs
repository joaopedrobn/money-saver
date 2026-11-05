import { test } from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { issueValidatorToken } from './prepare-sync-validator-token.mjs'

test('issues a short-lived approval-only JWT with a real valid ES256 signature', async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])
  const jwk = {
    ...(await webcrypto.subtle.exportKey('jwk', pair.privateKey)),
    kid: 'ephemeral-unit-key',
  }
  const token = await issueValidatorToken(jwk, 10000)
  const [header, payload, signature] = token.split('.')
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), {
    alg: 'ES256',
    typ: 'JWT',
    kid: jwk.kid,
  })
  const claims = JSON.parse(Buffer.from(payload, 'base64url'))
  assert.deepEqual(claims, {
    iss: 'https://iwzmsbkbuerleocismhj.supabase.co/auth/v1',
    aud: 'authenticated',
    role: 'money_saver_sync_validator',
    iat: 10000,
    nbf: 9995,
    exp: 13600,
  })
  assert.equal(
    await webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.publicKey,
      Buffer.from(signature, 'base64url'),
      Buffer.from(`${header}.${payload}`),
    ),
    true,
  )
  assert.equal(
    await webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.publicKey,
      Buffer.from(signature, 'base64url'),
      Buffer.from(`${header}.${payload}tampered`),
    ),
    false,
  )
})
test('rejects public-only or unexpected keys without producing a credential', async () => {
  for (const jwk of [
    {},
    { kty: 'oct', k: 'unit' },
    { kty: 'EC', crv: 'P-256', x: 'unit', y: 'unit', kid: 'unit' },
  ])
    await assert.rejects(issueValidatorToken(jwk), /private JWK/)
})
