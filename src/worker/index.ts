import { z } from 'zod'
import { canonicalJson, sha256, MAX_IMPORT_BYTES } from '../infrastructure/sync/protocol'
import { validateImportForApproval } from '../infrastructure/sync/trusted-validation'
import { validateDelta, type WireData } from '../infrastructure/sync/incremental'

export interface WorkerEnv {
  LAB_ONLY: string
  SUPABASE_URL: string
  SUPABASE_PUBLIC_KEY: string
  SYNC_VALIDATOR_TOKEN: string // Dedicated approval-only role, never service_role.
}
export class SyncHttpError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code)
  }
}
const requestSchema = z
  .object({
    operationId: z.uuid(),
    expectedRevision: z.number().int().nonnegative().safe(),
    payloadText: z.string(),
    kind: z.enum(['initial-import', 'changes']),
  })
  .strict()
function reply(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}
function localGate(env: WorkerEnv) {
  const url = new URL(env.SUPABASE_URL)
  if (
    env.LAB_ONLY !== 'true' ||
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '54321' ||
    url.pathname !== '/' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new SyncHttpError(503, 'SYNC_DISABLED')
  if (!env.SYNC_VALIDATOR_TOKEN || !env.SUPABASE_PUBLIC_KEY)
    throw new SyncHttpError(503, 'CONFIGURATION')
}
async function boundedBody(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) throw new SyncHttpError(400, 'EMPTY_BODY')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_IMPORT_BYTES * 2) {
        await reader.cancel()
        throw new SyncHttpError(413, 'BODY_LIMIT')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const requestId = crypto.randomUUID()
    try {
      localGate(env)
      const authorization = request.headers.get('Authorization')
      if (!authorization || !/^Bearer [A-Za-z0-9_.-]+$/.test(authorization))
        throw new SyncHttpError(401, 'AUTH_REQUIRED')
      const headers = {
        apikey: env.SUPABASE_PUBLIC_KEY,
        Authorization: authorization,
        'Content-Type': 'application/json',
      }
      let userResponse: Response
      try {
        userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
          headers,
          signal: AbortSignal.timeout(10000),
          redirect: 'manual',
        })
      } catch {
        throw new SyncHttpError(503, 'AUTH_CONNECTION_FAILED')
      }
      if (!userResponse.ok)
        throw new SyncHttpError(userResponse.status >= 500 ? 503 : 401, 'SESSION_INVALID')
      const user = z
        .object({ id: z.uuid(), email_confirmed_at: z.string() })
        .parse(await userResponse.json())
      async function rpc(name: string, body: unknown, privileged = false) {
        const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
          method: 'POST',
          headers: privileged
            ? { ...headers, Authorization: `Bearer ${env.SYNC_VALIDATOR_TOKEN}` }
            : headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
          redirect: 'manual',
        })
        if (!response.ok) {
          const error = (await response.json().catch(() => ({}))) as { code?: string }
          throw new SyncHttpError(
            error.code === '40001' || error.code === '23505'
              ? 409
              : error.code === '55P03'
                ? 503
                : 422,
            error.code ?? 'RPC_REJECTED',
          )
        }
        const text = await response.text()
        return text ? JSON.parse(text) : null
      }
      const url = new URL(request.url)
      if (url.pathname === '/view' && request.method === 'GET')
        return reply({ data: await rpc('ms_sync_view', {}) })
      if (url.pathname === '/changes' && request.method === 'POST') {
        const cursor = z
          .object({
            p_after: z.number().int().nonnegative(),
            p_until: z.number().int().nonnegative().nullable().optional(),
            p_revision: z.number().int().nonnegative().optional(),
            p_entity: z.string().max(32).optional(),
            p_id: z.uuid().optional(),
            p_limit: z.number().int().min(1).max(100).optional(),
          })
          .strict()
          .parse(JSON.parse(await boundedBody(request)))
        return reply({ data: await rpc('ms_changes', cursor) })
      }
      if (url.pathname !== '/operations' || request.method !== 'POST')
        throw new SyncHttpError(404, 'NOT_FOUND')
      const input = requestSchema.parse(JSON.parse(await boundedBody(request)))
      if (
        new TextEncoder().encode(input.payloadText).length >
        (input.kind === 'changes' ? 1048576 : MAX_IMPORT_BYTES)
      )
        throw new SyncHttpError(413, 'PAYLOAD_LIMIT')
      const hash = await sha256(input.payloadText)
      const view = (await rpc('ms_sync_view', { p_operation: input.operationId })) as {
        revision: number
        data: WireData
        receipt: { payloadHash: string; revision: number } | null
      }
      if (view.receipt) {
        if (
          view.receipt.payloadHash !== hash ||
          view.receipt.revision !== input.expectedRevision + 1
        )
          throw new SyncHttpError(409, 'OPERATION_REUSED')
        return reply({ data: view.receipt })
      }
      if (view.revision !== input.expectedRevision)
        throw new SyncHttpError(409, 'REVISION_CONFLICT')
      let manifestHash: string
      let version: string
      try {
        if (input.kind === 'initial-import') {
          const approval = await validateImportForApproval({ verifiedUserId: user.id, ...input })
          manifestHash = approval.reconciliation_hash
          version = approval.validator_version
        } else {
          const payload: unknown = JSON.parse(input.payloadText)
          if (canonicalJson(payload) !== input.payloadText)
            throw new SyncHttpError(422, 'NON_CANONICAL')
          const result = await validateDelta(view.data, payload, user.id)
          manifestHash = await sha256(canonicalJson(result.manifest))
          version = 'money-saver-domain-v2'
        }
      } catch (error) {
        if (error instanceof SyncHttpError) throw error
        throw new SyncHttpError(422, 'FINANCIAL_VALIDATION_FAILED')
      }
      await rpc(
        'ms_approve',
        {
          p_user: user.id,
          p_operation: input.operationId,
          p_revision: input.expectedRevision,
          p_hash: hash,
          p_manifest: manifestHash,
          p_version: version,
        },
        true,
      )
      return reply({
        data: await rpc(
          input.kind === 'initial-import' ? 'ms_import_initial' : 'ms_apply_changes',
          {
            p_operation_id: input.operationId,
            p_expected_revision: input.expectedRevision,
            p_payload_text: input.payloadText,
          },
        ),
      })
    } catch (error) {
      const status =
        error instanceof SyncHttpError
          ? error.status
          : error instanceof z.ZodError || error instanceof SyntaxError
            ? 422
            : 503
      return reply(
        {
          error: {
            code:
              error instanceof SyncHttpError
                ? error.code
                : status === 422
                  ? 'INVALID_PAYLOAD'
                  : 'VALIDATION_OR_CONNECTION_FAILED',
            requestId,
          },
        },
        status,
      )
    }
  },
}
