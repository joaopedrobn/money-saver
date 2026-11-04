import { expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { financialDatabaseName } from '../financial-context'
import { fixture, operationId, owner, projectUrl } from './fixtures.test-data'
import {
  assertReconciled,
  assertSameOperation,
  canonicalJson,
  confirmImportPreview,
  entities,
  prepareInitialImport,
  sha256,
  submitFinancialImport,
} from './protocol'
import { validateImportForApproval } from './trusted-validation'
import { disabledSyncState, reduceSync } from './state'
import { SyncStatus } from '@/features/settings/SyncStatus'
const scope = { userId: owner, projectUrl }
const input = () => ({
  operationId,
  scope,
  localDatabase: financialDatabaseName(scope),
  backup: fixture(),
  remoteHead: {
    revision: 0,
    counts: Object.fromEntries(entities.map((e) => [e, 0])) as Record<
      (typeof entities)[number],
      number
    >,
  },
  asOf: '2026-11-04' as const,
})

it('prepares stable exact-content retries, preserves UUIDs/centavos, and rejects operation reuse with changed data or owner', async () => {
  const first = await prepareInitialImport(input())
  const retry = await prepareInitialImport(input())
  expect(() => assertSameOperation(first, retry)).not.toThrow()
  expect(first.payloadHash).toBe(await sha256(first.payloadText))
  expect(JSON.parse(first.payloadText).data.accounts[0].opening_balance_cents).toBe(10000)
  const changed = input()
  changed.backup.data.accounts[0].name = 'Outra conta'
  expect(() => assertSameOperation(first, { ...retry, payloadHash: 'different' })).toThrow(
    'reutilizada',
  )
  expect(() => assertSameOperation(first, { ...retry, userId: crypto.randomUUID() })).toThrow(
    'reutilizada',
  )
  expect((await prepareInitialImport(changed)).payloadHash).not.toBe(first.payloadHash)
})
it('requires matching account-local scope, empty remote revision and a saved backup plus unchanged explicit preview', async () => {
  const source = input()
  await expect(prepareInitialImport({ ...source, localDatabase: 'money-saver' })).rejects.toThrow(
    'espaço local',
  )
  await expect(
    prepareInitialImport({ ...source, remoteHead: { ...source.remoteHead, revision: 1 } }),
  ).rejects.toThrow('conflito')
  const counts = { ...source.remoteHead.counts, audit: 1 }
  await expect(
    prepareInitialImport({ ...source, remoteHead: { revision: 0, counts } }),
  ).rejects.toThrow('conflito')
  const plan = await prepareInitialImport(source)
  const confirmation = {
    confirmation: 'IMPORTAR PARA A NUVEM',
    savedBackupHash: plan.backupHash,
    currentBackup: fixture(),
    userId: owner,
    projectUrl,
  }
  await expect(confirmImportPreview(plan, { ...confirmation, confirmation: '' })).rejects.toThrow(
    'confirmação',
  )
  await expect(confirmImportPreview(plan, confirmation)).resolves.toMatchObject({ operationId })
  const changed = fixture()
  changed.data.accounts[0].openingBalanceCents++
  await expect(
    confirmImportPreview(plan, { ...confirmation, currentBackup: changed }),
  ).rejects.toThrow('mudaram')
})
it('reuses the financial domain for approval and reconciliation, rejecting partial credit bundles and forged ownership/manifests', async () => {
  const plan = await prepareInitialImport(input())
  const body = JSON.parse(plan.payloadText)
  const approval = () =>
    validateImportForApproval({
      verifiedUserId: owner,
      operationId,
      expectedRevision: 0,
      payloadText: canonicalJson(body),
    })
  await expect(approval()).resolves.toMatchObject({ payload_hash: plan.payloadHash })
  await expect(assertReconciled(plan.manifest, body.data, owner)).resolves.toBeUndefined()
  body.data.installments.pop()
  await expect(approval()).rejects.toThrow('parcelas')
  await expect(assertReconciled(plan.manifest, body.data, owner)).rejects.toThrow()
  const forged = JSON.parse(plan.payloadText)
  forged.data.accounts[0].user_id = crypto.randomUUID()
  await expect(
    validateImportForApproval({
      verifiedUserId: owner,
      operationId,
      expectedRevision: 0,
      payloadText: canonicalJson(forged),
    }),
  ).rejects.toThrow('outro usuário')
  const totals = JSON.parse(plan.payloadText)
  totals.manifest.cards[0].debt++
  await expect(
    validateImportForApproval({
      verifiedUserId: owner,
      operationId,
      expectedRevision: 0,
      payloadText: canonicalJson(totals),
    }),
  ).rejects.toThrow('adulterada')
})
it('keeps transport and UI disabled and treats disconnect after send as unknown until the same operation is reconciled', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  try {
    await expect(submitFinancialImport()).rejects.toThrow('desativada')
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    fetch.mockRestore()
  }
  expect(
    reduceSync(disabledSyncState, { type: 'reconciled', operationId, at: '2026-11-04T12:00:00Z' }),
  ).toEqual(disabledSyncState)
  let state = reduceSync(
    { ...disabledSyncState, enabled: true },
    { type: 'prepared', operationId, pending: 3 },
  )
  state = reduceSync(state, { type: 'sending' })
  state = reduceSync(state, { type: 'connection-lost', operationId })
  expect(state.phase).toBe('outcome-unknown')
  expect(state.lastCompletedAt).toBeNull()
  expect(() =>
    reduceSync(state, { type: 'prepared', operationId: crypto.randomUUID(), pending: 1 }),
  ).toThrow('inválida')
  expect(reduceSync(state, { type: 'committed', operationId: crypto.randomUUID() })).toBe(state)
  expect(() => reduceSync(state, { type: 'reconciled', operationId, at: 'now' })).toThrow(
    'inválida',
  )
  state = reduceSync(state, { type: 'sending' })
  state = reduceSync(state, { type: 'committed', operationId })
  state = reduceSync(state, { type: 'reconciled', operationId, at: '2026-11-04T12:00:00Z' })
  expect(state.pending).toBe(0)
  const html = renderToStaticMarkup(
    createElement(SyncStatus, { state: { ...state, enabled: false } }),
  )
  expect(html).toContain('Sincronização desativada')
  expect(html).not.toContain('2026-11-04T12:00:00Z')
})
it('keeps the prepared SQL fixture validated by the real domain validator (not a database security test)', async () => {
  const sql = readFileSync('supabase/tests/fixtures/initial-import.sql', 'utf8')
  const payloadText = sql.split('$money_saver_fixture$')[1]
  await expect(
    validateImportForApproval({
      verifiedUserId: owner,
      operationId,
      expectedRevision: 0,
      payloadText,
    }),
  ).resolves.toHaveProperty('payload_hash')
})
