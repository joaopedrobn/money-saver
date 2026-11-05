import { webcrypto } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, relative, sep, dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import console from 'node:console'

const issuer = 'https://iwzmsbkbuerleocismhj.supabase.co/auth/v1'
/** Offline issuance only. Acceptance of kid/signature by Supabase must be verified separately.
 * Does not create/import keys, access the network, upload secrets or activate sync. */
export async function issueValidatorToken(jwk, now = Math.floor(Date.now() / 1000)) {
  if (
    jwk.kty !== 'EC' ||
    jwk.crv !== 'P-256' ||
    !jwk.d ||
    !jwk.x ||
    !jwk.y ||
    typeof jwk.kid !== 'string' ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(jwk.kid)
  )
    throw new Error('An existing ES256 private JWK with its accepted Supabase kid is required.')
  const key = await webcrypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = encode({ alg: 'ES256', typ: 'JWT', kid: jwk.kid })
  // No role/TTL/owner override. No user identity is asserted by this credential.
  const payload = encode({
    iss: issuer,
    aud: 'authenticated',
    role: 'money_saver_sync_validator',
    iat: now,
    nbf: now - 5,
    exp: now + 3600,
  })
  const content = `${header}.${payload}`
  const signature = await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    Buffer.from(content),
  )
  return `${content}.${Buffer.from(signature).toString('base64url')}`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.version !== 'v26.7.0') throw new Error('Use Node.js 26.7.0')
  const [, , flag, keyPath, outputFlag, outputPath] = process.argv
  if (process.argv.length !== 6 || flag !== '--jwk-file' || outputFlag !== '--output')
    throw new Error(
      'Usage: node scripts/prepare-sync-validator-token.mjs --jwk-file <existing-private-jwk> --output <.local/file>',
    )
  const localDir = resolve(import.meta.dirname, '../.local')
  const output = resolve(outputPath)
  const inside = relative(localDir, output)
  if (
    !inside ||
    isAbsolute(inside) ||
    inside.startsWith('..' + sep) ||
    inside === '..' ||
    resolve(keyPath) === output
  )
    throw new Error('Output must be a new file inside ignored .local/.')
  const token = await issueValidatorToken(JSON.parse(await readFile(keyPath, 'utf8')))
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, token + '\n', { flag: 'wx', mode: 0o600 })
  console.log(
    'Approval-only JWT saved locally; expires in one hour. No network, deployment or activation performed.',
  )
}
