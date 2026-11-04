import { decodeRemoteBackup } from '../supabase/mapping'
import {
  canonicalJson,
  MAX_IMPORT_BYTES,
  reconciliationManifest,
  requireUuid,
  sha256,
  type Manifest,
} from './protocol'

/** Future trusted worker only. The browser cannot INSERT approval records.
 * The caller must verify the JWT on the server and obtain the remote revision itself.
 * This pure validator neither grants approvals in PostgreSQL nor performs network I/O. */
export async function validateImportForApproval(input: {
  verifiedUserId: string
  operationId: string
  expectedRevision: number
  payloadText: string
}) {
  requireUuid(input.verifiedUserId)
  requireUuid(input.operationId)
  if (
    input.expectedRevision !== 0 ||
    new TextEncoder().encode(input.payloadText).length > MAX_IMPORT_BYTES
  )
    throw new Error('Operação fora do escopo da importação inicial.')
  const payload = JSON.parse(input.payloadText) as {
    protocol: number
    asOf: Manifest['asOf']
    data: unknown
    manifest: Manifest
  }
  if (
    canonicalJson(payload) !== input.payloadText ||
    Object.keys(payload).sort().join(',') !== 'asOf,data,manifest,protocol' ||
    payload.protocol !== 1
  )
    throw new Error('Envelope de importação inválido.')
  const backup = decodeRemoteBackup(payload.data, input.verifiedUserId)
  const actual = await reconciliationManifest(backup, payload.asOf)
  if (canonicalJson(actual) !== canonicalJson(payload.manifest))
    throw new Error('Prévia financeira adulterada ou divergente.')
  return {
    user_id: input.verifiedUserId,
    operation_id: input.operationId,
    expected_revision: 0,
    payload_hash: await sha256(input.payloadText),
    validator_version: 'money-saver-domain-v1',
    reconciliation_hash: await sha256(canonicalJson(actual)),
  }
}
