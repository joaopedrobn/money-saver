import { createServer } from 'vite'
import { createClient } from '@supabase/supabase-js'
import 'fake-indexeddb/auto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import console from 'node:console'
import { randomUUID } from 'node:crypto'
/* global fetch, AbortController, AbortSignal */

// Deliberately bounded: one concurrent pair OR one isolation/reconciliation round. No retries.
const mode = process.argv[2]
if (process.version !== 'v26.7.0' || !['--conflict', '--isolation-reconciliation'].includes(mode))
  throw new Error('Node 26.7.0 and an explicit bounded test mode required')
const dir = resolve('.local/remote-bidirectional')
const fixture = JSON.parse(readFileSync(resolve(dir, 'fixtures.private.json'), 'utf8'))
const executionId = randomUUID()
if (fixture.project !== 'iwzmsbkbuerleocismhj' || fixture.users.length !== 2 ||
  !fixture.users.every(u => u.email.startsWith(`money-saver-remote-${fixture.runId}-`) && u.email.endsWith('@example.invalid')))
  throw new Error('Unrecognized fictitious users')
if (mode !== '--conflict' && !JSON.parse(readFileSync(resolve(dir, 'final-conflict.json'), 'utf8')).passed)
  throw new Error('Concurrent edit must pass first')
const project = 'https://iwzmsbkbuerleocismhj.supabase.co'
const api = 'https://money-saver.quem-votar-jp.workers.dev/sync-api'
const date = '2026-11-05', clients = [], authClients = [], results = []
const report = { mode, fixtureScope: fixture.runId, executionId, startedAt: new Date().toISOString(), results, passed: false }
const check = (value, message) => { if (!value) throw new Error(message) }
const vite = await createServer({ envFile: false, server: { middlewareMode: true }, appType: 'custom' })
try {
  const { SyncClient, SyncLabDatabase, workerTransport } = await vite.ssrLoadModule('/src/infrastructure/sync/outbox.ts')
  const protocol = await vite.ssrLoadModule('/src/infrastructure/sync/protocol.ts')
  const mapping = await vite.ssrLoadModule('/src/infrastructure/supabase/mapping.ts')
  const transport = workerTransport(api)
  const open = async (user, label, customTransport = transport) => {
    const auth = createClient(project, fixture.publicKey, { auth: { persistSession: false, autoRefreshToken: false } })
    authClients.push(auth)
    const login = await auth.auth.signInWithPassword({ email: user.email, password: user.password })
    check(!login.error && login.data.user?.id === user.id, 'Fixture authentication failed')
    const token = login.data.session.access_token
    const client = new SyncClient(new SyncLabDatabase(`money-saver-sync-lab:${user.id}:final-${Date.now()}:${label}`), user.id, customTransport,
      () => ({ userId: user.id, accessToken: token }), date, undefined, project)
    clients.push(client)
    await client.bootstrap()
    return { client, token }
  }
  if (mode === '--conflict') {
    const outcomes = []
    const measured = { ...transport, async send(...args) {
      const start = Date.now()
      try { const result = await transport.send(...args); outcomes.push({ status: 200, elapsedMs: Date.now() - start }); return result }
      catch (error) { outcomes.push({ status: error.status, code: error.serverCode, elapsedMs: Date.now() - start }); throw error }
    } }
    const a = await open(fixture.users[0], 'pc', measured), b = await open(fixture.users[0], 'phone', measured)
    const views = await Promise.all([a.client.db.syncHead.get('head'), b.client.db.syncHead.get('head')])
    check(views[0].revision === views[1].revision, 'Initial revisions differ')
    const account = (await a.client.repositories.accounts.list())[0]
    check(account, 'Existing fictitious account missing')
    const names = ['REMOTE FIXTURE final concurrent PC', 'REMOTE FIXTURE final concurrent PHONE']
    for (const [i, device] of [a, b].entries())
      await device.client.repositories.accounts.update(account.id, { ...account, name: names[i] })
    const race = await Promise.allSettled([a.client.flush(), b.client.flush()])
    check(race.filter(r => r.status === 'fulfilled').length === 1, 'Expected exactly one committed edit')
    const loserIndex = race.findIndex(r => r.status === 'rejected'), loser = [a, b][loserIndex].client
    check(race[loserIndex].reason.status === 409, 'Concurrent loser did not return HTTP 409')
    check((await loser.status()).phase === 'conflict', 'Conflict not exposed')
    const pending = await loser.pending()
    check(pending.length === 1 && pending[0].state === 'conflict', 'Rejected edit was not retained')
    const server = await transport.view(a.token, new AbortController().signal)
    check(server.revision === views[0].revision + 1, 'More than one revision committed')
    check(server.data.accounts.find(r => r.id === account.id).name === names[1 - loserIndex], 'Winner overwritten')
    writeFileSync(resolve(dir, 'rejected-conflict.private.json'), JSON.stringify(pending, null, 2))
    report.outcomes = outcomes
    report.revision = server.revision
    results.push('HTTP 200 + structured HTTP 409; one revision; winning edit preserved; rejected outbox retained')
  } else {
    // A reviewed inventory proves legacy IDs; the registry tracks stable logical roles
    // and every later execution. Neither account ownership nor provenance is inferred from names.
    const inventory = JSON.parse(readFileSync(resolve(dir, 'fixture-inventory-before.private.json'), 'utf8'))
    check(inventory.runId === fixture.runId && fixture.users.every(u => inventory.owners.includes(u.id)), 'Inventory scope differs')
    const registryPath = resolve(dir, 'fixture-registry.private.json')
    let registry
    try { registry = JSON.parse(readFileSync(registryPath, 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw error; registry = { runId: fixture.runId, roles: {}, executions: [] } }
    check(registry.runId === fixture.runId, 'Registry belongs to a different fixture scope')
    const execution = { id: executionId, operations: [], resources: [] }
    registry.executions.push(execution)
    const save = () => writeFileSync(registryPath, JSON.stringify(registry, null, 2))
    save()
    const ensure = async (device, user, entity, role, input, legacyName) => {
      const repository = device.client.repositories[entity]
      const rows = await repository.list()
      const saved = registry.roles[role]
      if (saved) check(saved.owner === user.id && saved.entity === entity, 'Registry role ownership differs')
      const legacyIds = inventory.data[entity].filter(r => r.user_id === user.id && (!legacyName || r.name === legacyName)).map(r => r.id).sort()
      let row = rows.find(r => r.id === saved?.id) ?? rows.find(r => legacyIds.includes(r.id))
      if (row) {
        check(entity !== 'categories' || (row.direction === input.direction && !row.archived), 'Existing fixture category has unexpected semantics')
      } else {
        const name = `REMOTE FIXTURE ${fixture.runId} ${role}`
        check(!rows.some(r => r.name === name), 'Unregistered name collision: preserve and inspect')
        row = await repository.create({ ...input, name })
      }
      registry.roles[role] = { owner: user.id, entity, id: row.id }
      execution.resources.push(registry.roles[role])
      execution.operations.push(...(await device.client.pending()).map(op => op.id))
      save() // Persist IDs before any remote send; UUIDs come from the existing repositories.
      if ((await device.client.pending()).length) await device.client.drain()
      check(!(await device.client.pending()).length, 'Fixture setup has unconfirmed operations')
      return row
    }
    const accountInput = { institution: 'Fictitious', type: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01', color: 'sage' }
    const a = await open(fixture.users[0], 'pc')
    const accountA = await ensure(a, fixture.users[0], 'accounts', 'isolation-account-a', accountInput)
    const phone = await open(fixture.users[0], 'phone'), b = await open(fixture.users[1], 'other')
    const accountB = await ensure(b, fixture.users[1], 'accounts', 'isolation-account-b', accountInput)
    const category = await ensure(b, fixture.users[1], 'categories', 'isolation-expense-b', { direction: 'expense', color: 'rose', icon: 'coffee' }, 'REMOTE FIXTURE B final expense')
    const foreign = await b.client.repositories.movements.create({ kind: 'transaction', description: `REMOTE FIXTURE ${fixture.runId} ${executionId} forbidden`, amountCents: 1, accountId: accountB.id, categoryId: category.id, direction: 'expense', method: 'pix', date: '2026-02-01', status: 'settled', settledDate: '2026-02-01' })
    const op = (await b.client.pending())[0], altered = JSON.parse(op.payloadText)
    execution.operations.push(op.id)
    execution.resources.push({ owner: fixture.users[1].id, entity: 'transactions', id: foreign.id, expectedRejected: true })
    save()
    altered.changes.find(c => c.entity === 'transactions').row.account_id = accountA.id
    const rejected = await fetch(api + '/operations', { method: 'POST', headers: { Authorization: 'Bearer ' + b.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ operationId: op.id, expectedRevision: op.expectedRevision, kind: op.kind, payloadText: protocol.canonicalJson(altered) }), signal: AbortSignal.timeout(20000) })
    check(rejected.status === 422 || rejected.status === 403, 'Cross-owner reference was not rejected as invalid')
    const viewB = await transport.view(b.token, new AbortController().signal)
    check(!viewB.data.transactions.some(r => r.id === foreign.id), 'Cross-owner reference left partial data')
    check(Object.values(viewB.data).every(rows => rows.every(r => r.user_id === fixture.users[1].id)), 'Owner B read leakage')
    check((await transport.view(a.token, new AbortController().signal)).data.accounts.every(r => r.user_id === fixture.users[0].id), 'Owner A read leakage')
    const headers = { apikey: fixture.publicKey, Authorization: 'Bearer ' + b.token, 'Content-Type': 'application/json' }
    const url = project + '/rest/v1/ms_accounts?id=eq.' + accountA.id
    const read = await fetch(url, { headers, signal: AbortSignal.timeout(20000) })
    check(read.ok && (await read.json()).length === 0, 'RLS leaked account A to B')
    for (const method of ['PATCH', 'DELETE']) {
      const response = await fetch(url, { method, headers, ...(method === 'PATCH' ? { body: JSON.stringify({ name: 'REMOTE FIXTURE unauthorized' }) } : {}), signal: AbortSignal.timeout(20000) })
      check(response.status === 401 || response.status === 403, 'Generic ' + method + ' unexpectedly permitted')
    }
    results.push('Two owners isolated; foreign reference rejected atomically; generic edit/delete blocked')
    const server = await transport.view(a.token, new AbortController().signal)
    const backups = await Promise.all([a.client.repositories.backup.export(), phone.client.repositories.backup.export()])
    const manifests = await Promise.all([...backups, mapping.decodeRemoteBackup(server.data, fixture.users[0].id)].map(backup => protocol.reconciliationManifest(backup, date)))
    check(manifests.every(m => protocol.canonicalJson(m) === protocol.canonicalJson(manifests[0])), 'Remote financial reconciliation differs')
    // Decode/manifest invokes the existing full backup/reference and financial invariants.
    const manifestB = await protocol.reconciliationManifest(mapping.decodeRemoteBackup(viewB.data, fixture.users[1].id), date)
    check(manifestB, 'Owner B financial integrity missing')
    results.push('Both owner snapshots pass existing financial validation and relationship integrity')
    report.reconciliation = manifests[0]
    results.push('Two independent IndexedDB caches and remote snapshot: balances, invoice/card totals, UUIDs and relationships reconcile')
  }
  report.passed = true
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  report.error = error.message
  report.status = error.status
  console.error('FAIL ' + error.message)
  process.exitCode = 1
} finally {
  for (const client of clients) { client.stop(); client.db.close() }
  for (const auth of authClients) auth.auth.stopAutoRefresh()
  await vite.close()
  report.finishedAt = new Date().toISOString()
  writeFileSync(resolve(dir, mode === '--conflict' ? 'final-conflict.json' : 'final-isolation-reconciliation.json'), JSON.stringify(report, null, 2))
}
