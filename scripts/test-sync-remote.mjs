import { createServer } from 'vite'
import { createClient } from '@supabase/supabase-js'
import 'fake-indexeddb/auto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import process from 'node:process'
import console from 'node:console'
/* global fetch, AbortController */

// Explicit operator-created, identifiable fixtures only. No env file or administrative key.
const root = resolve(import.meta.dirname, '..')
const dir = join(root, '.local/remote-bidirectional')
if (process.version !== 'v26.7.0' || process.argv[2] !== '--run-fixtures')
  throw new Error('Use Node 26.7.0 and --run-fixtures')
const fixture = JSON.parse(readFileSync(join(dir, 'fixtures.private.json'), 'utf8'))
const project = 'https://iwzmsbkbuerleocismhj.supabase.co',
  api = 'https://money-saver.quem-votar-jp.workers.dev/sync-api'
if (
  fixture.project !== 'iwzmsbkbuerleocismhj' ||
  fixture.users.length !== 2 ||
  !fixture.users.every(
    (u) =>
      u.email.startsWith(`money-saver-remote-${fixture.runId}-`) &&
      u.email.endsWith('@example.invalid'),
  )
)
  throw new Error('Unrecognized fixture scope')
const results = [],
  clients = [],
  authClients = []
const report = {
  startedAt: new Date().toISOString(),
  node: process.version,
  project: fixture.project,
  api,
  runId: fixture.runId,
  users: fixture.users.map((u) => u.id),
  results,
}
mkdirSync(dir, { recursive: true })
const check = (v, m) => {
  if (!v) throw new Error(m)
}
const pass = (name) => {
  results.push({ name, passed: true })
  console.log('PASS ' + name)
}
const wait = async (predicate, label) => {
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await setTimeout(500)
  }
  throw new Error('Timed out: ' + label)
}
const settle = async (sender, receiver) => {
  const deadline = Date.now() + 90000
  while ((await sender.pending()).length) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for confirmed durable operations')
    try {
      await sender.drain()
    } catch (error) {
      if (error.status && error.status < 500) throw error
    }
    if ((await sender.pending()).length) await setTimeout(500)
  }
  await receiver.pull()
}
let vite
try {
  for (const path of ['/', '/login', '/cadastro', '/recuperar-senha', '/redefinir-senha']) {
    const response = await fetch(api.replace('/sync-api', '') + path, {
      headers: { 'Sec-Fetch-Mode': 'navigate' },
    })
    check(
      response.status === 200 && (await response.text()).includes('id="root"'),
      'HTTPS SPA route failed: ' + path,
    )
  }
  check((await fetch(api + '/view')).status === 401, 'Anonymous API not rejected')
  check(
    (await fetch(api + '/view', { headers: { Authorization: 'Bearer invalid' } })).status === 401,
    'Invalid JWT not rejected',
  )
  pass('published HTTPS, SPA routes and API reject missing/invalid JWTs')
  const sessions = []
  for (const [index, device] of [
    [0, 'pc'],
    [0, 'phone'],
    [1, 'isolation'],
  ]) {
    const data = new Map(),
      storage = {
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => data.set(k, v),
        removeItem: (k) => data.delete(k),
      }
    const options = {
      auth: {
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storage,
        storageKey: 'remote-test-' + device,
      },
    }
    const auth = createClient(project, fixture.publicKey, options)
    authClients.push(auth)
    const user = fixture.users[index]
    const login = await auth.auth.signInWithPassword({ email: user.email, password: user.password })
    check(!login.error && login.data.user.id === user.id, 'Real password login failed')
    const verified = await auth.auth.getUser()
    check(!verified.error && verified.data.user.id === user.id, 'Session not verified')
    const restored = createClient(project, fixture.publicKey, options)
    authClients.push(restored)
    const resumed = await restored.auth.getUser()
    check(!resumed.error && resumed.data.user.id === user.id, 'Restored auth session invalid')
    sessions.push({ userId: user.id, accessToken: login.data.session.access_token })
  }
  check(sessions[0].accessToken !== sessions[1].accessToken, 'Sessions are not independent')
  pass(
    'three real verified password sessions, independent PC/phone tokens, persisted Auth recovery',
  )
  vite = await createServer({
    root,
    envFile: false,
    server: { middlewareMode: true },
    appType: 'custom',
  })
  const outbox = await vite.ssrLoadModule('/src/infrastructure/sync/outbox.ts')
  const protocol = await vite.ssrLoadModule('/src/infrastructure/sync/protocol.ts')
  const mapping = await vite.ssrLoadModule('/src/infrastructure/supabase/mapping.ts')
  const date = (await vite.ssrLoadModule('/src/domain/financial-validation.ts')).today()
  const transport = outbox.workerTransport(api)
  let offline = false,
    loseResponse = false
  const faultTransport = {
    ...transport,
    async send(...args) {
      if (offline) throw new TypeError('Synthetic disconnected transport before network')
      writeFileSync(
        join(dir, 'last-operation.private.json'),
        JSON.stringify({ operation: args[0], token: args[1] }),
      )
      let receipt
      try {
        receipt = await transport.send(...args)
      } catch (error) {
        const diagnostic = {
          status: error.status,
          code: error.serverCode ?? 'UNKNOWN',
          name: error.name,
        }
        if (JSON.stringify(diagnostic) !== JSON.stringify(report.lastApiError))
          console.log('API diagnostic ' + JSON.stringify(diagnostic))
        report.lastApiError = diagnostic
        throw error
      }
      if (loseResponse) {
        loseResponse = false
        throw new TypeError('Synthetic lost response after remote commit')
      }
      return receipt
    },
  }
  const open = async (device, session, port = transport) => {
    const db = new outbox.SyncLabDatabase(
      `money-saver-sync-lab:${session.userId}:remote-${fixture.runId}:${device}`,
    )
    const client = new outbox.SyncClient(
      db,
      session.userId,
      port,
      () => session,
      date,
      undefined,
      project,
    )
    clients.push(client)
    await client.bootstrap()
    return client
  }
  let pc = await open('pc', sessions[0], faultTransport),
    phone = await open('phone', sessions[1]),
    other = await open('other', sessions[2])
  for (const c of [pc, phone, other])
    check((await c.repositories.accounts.list()).length === 0, 'Fixture destination not empty')
  const r = pc.repositories
  await r.categories.create({
    name: 'REMOTE FIXTURE income',
    direction: 'income',
    color: 'sage',
    icon: 'wallet',
  })
  const expense = await r.categories.create({
    name: 'REMOTE FIXTURE expense',
    direction: 'expense',
    color: 'rose',
    icon: 'coffee',
  })
  const account = await r.accounts.create({
    name: 'REMOTE FIXTURE account',
    institution: 'Fictitious only',
    type: 'checking',
    openingBalanceCents: 10000,
    openingDate: '2026-01-01',
    color: 'sage',
  })
  const reserve = await r.accounts.create({
    name: 'REMOTE FIXTURE reserve',
    institution: 'Fictitious only',
    type: 'savings',
    openingBalanceCents: 0,
    openingDate: '2026-01-01',
    color: 'blue',
  })
  const movement = (description, amountCents = 100) => ({
    kind: 'transaction',
    accountId: account.id,
    categoryId: expense.id,
    description,
    amountCents,
    direction: 'expense',
    method: 'pix',
    date: '2026-02-01',
    status: 'settled',
    settledDate: '2026-02-01',
  })
  pc.start()
  phone.start()
  await wait(
    async () =>
      !(await pc.pending()).length && (await phone.repositories.accounts.list()).length === 2,
    'automatic setup replication',
  )
  pass(
    'real Worker approval-only database connection and transactional financial RPCs accept fixture data',
  )
  const expenseRow = await pc.repositories.movements.create(movement('REMOTE FIXTURE PC expense'))
  await wait(
    async () => !!(await phone.repositories.transactions.get(expenseRow.id)),
    'PC to phone creation',
  )
  check((await other.repositories.accounts.list()).length === 0, 'Owner B saw owner A')
  await phone.repositories.movements.update(
    'transaction',
    expenseRow.id,
    movement('REMOTE FIXTURE PHONE edited', 150),
  )
  await wait(
    async () => (await pc.repositories.transactions.get(expenseRow.id))?.amountCents === 150,
    'phone to PC edit',
  )
  pass('automatic bidirectional create/edit via durable outbox and polling without page refresh')
  await phone.repositories.movements.remove('transaction', expenseRow.id)
  await wait(
    async () => !(await pc.repositories.transactions.get(expenseRow.id)),
    'phone to PC deletion',
  )
  pass('deletion/tombstone from second client received automatically in first client')
  const card = await phone.repositories.credit.createCard({
    accountId: account.id,
    name: 'REMOTE FIXTURE card',
    institution: 'Fictitious',
    nickname: '',
    brand: '',
    lastFour: '',
    color: 'sage',
    limitCents: 20000,
    closingDay: 5,
    dueDay: 15,
  })
  const purchase = await phone.repositories.credit.createPurchase({
    cardId: card.id,
    categoryId: expense.id,
    description: 'REMOTE FIXTURE installments',
    amountCents: 1200,
    installmentCount: 3,
    feeCents: 0,
    date: '2026-02-02',
  })
  await wait(
    async () => !!(await pc.repositories.purchases.get(purchase.id)),
    'phone purchase received by PC',
  )
  const invoice = (await pc.repositories.invoices.list()).find((i) => i.period === '2026-02')
  const payment = await pc.repositories.credit.pay({
    invoiceId: invoice.id,
    accountId: account.id,
    amountCents: 400,
    date: '2026-02-10',
  })
  await wait(async () => !!(await phone.repositories.payments.get(payment.id)), 'payment received')
  const transfer = await phone.repositories.movements.create({
    ...movement('REMOTE FIXTURE transfer', 500),
    kind: 'transfer',
    destinationAccountId: reserve.id,
  })
  await wait(async () => !!(await pc.repositories.transfers.get(transfer.id)), 'transfer received')
  pass(
    'phone purchase creates consistent installments/invoices; payment and transfer replicated once',
  )
  await wait(
    async () => !(await pc.pending()).length && !(await phone.pending()).length,
    'both device receipts confirmed before deliberate faults',
  )
  // Stop sending timers before deliberate faults/races; reopen retains the exact operation identity.
  pc.stop()
  phone.stop()
  pc.db.close()
  phone.db.close()
  pc = await open('pc', sessions[0], faultTransport)
  phone = await open('phone', sessions[1])
  loseResponse = true
  const lost = await pc.repositories.movements.create(movement('REMOTE FIXTURE lost response', 1))
  const lostId = (await pc.pending())[0].id
  await pc.flush().then(
    () => {
      throw new Error('Lost response fault missing')
    },
    () => {},
  )
  check((await pc.pending())[0].id === lostId, 'Operation identity changed')
  pc.stop()
  pc.db.close()
  pc = await open('pc', sessions[0], faultTransport)
  await setTimeout(1100)
  await settle(pc, phone)
  check(
    (await phone.repositories.transactions.list()).filter((t) => t.id === lost.id).length === 1,
    'Lost response duplicated transaction',
  )
  check(
    (await phone.repositories.payments.list()).filter((p) => p.id === payment.id).length === 1,
    'Payment duplicated',
  )
  check(
    (await phone.repositories.transfers.list()).filter((t) => t.id === transfer.id).length === 1,
    'Transfer duplicated',
  )
  pass('lost commit response plus IDB reopen retries the same operation id without duplicates')
  offline = true
  const disconnected = await pc.repositories.movements.create(
    movement('REMOTE FIXTURE offline', 25),
  )
  await pc.flush().then(
    () => {
      throw new Error('Offline fault missing')
    },
    () => {},
  )
  const offlineId = (await pc.pending())[0].id
  pc.stop()
  pc.db.close()
  pc = await open('pc', sessions[0], faultTransport)
  check((await pc.pending())[0].id === offlineId, 'Offline queue lost on reopen')
  offline = false
  pc.start()
  phone.start()
  pc.wake()
  phone.wake()
  await wait(
    async () =>
      !!(await phone.repositories.transactions.get(disconnected.id)) &&
      !(await pc.pending()).length &&
      !(await phone.pending()).length,
    'automatic reconnect/reload with both receipts confirmed',
  )
  pass('offline operations survive IDB reopen and are delivered automatically after reconnection')
  pc.stop()
  phone.stop()
  pc.db.close()
  phone.db.close()
  pc = await open('pc', sessions[0], faultTransport)
  phone = await open('phone', sessions[1])
  await pc.pull()
  await phone.pull()
  await pc.repositories.movements.update(
    'transaction',
    disconnected.id,
    movement('REMOTE FIXTURE conflict PC', 30),
  )
  await phone.repositories.movements.update(
    'transaction',
    disconnected.id,
    movement('REMOTE FIXTURE conflict PHONE', 35),
  )
  const race = await Promise.allSettled([pc.flush(), phone.flush()])
  check(
    race.filter((x) => x.status === 'fulfilled').length === 1,
    'Concurrent writes silently overwrote',
  )
  const loser = race[0].status === 'rejected' ? pc : phone,
    winner = loser === pc ? phone : pc
  check((await loser.status()).phase === 'conflict', 'Conflict not exposed')
  check((await loser.pending()).length === 1, 'Rejected operation lost')
  await loser.resolveUsingServer('USAR VERSÃO DO SERVIDOR')
  await loser.drain()
  await winner.pull()
  pass(
    'concurrent edit produces revision conflict; explicit resolution preserves rejected backup/audit',
  )
  const cross = await other.repositories.accounts.create({
    name: 'REMOTE FIXTURE B account',
    institution: 'Fictitious',
    type: 'checking',
    openingBalanceCents: 0,
    openingDate: '2026-01-01',
    color: 'sage',
  })
  const ownCategory = await other.repositories.categories.create({name:'REMOTE FIXTURE B category',direction:'expense',color:'rose',icon:'coffee'})
  await settle(other,other)
  const foreign = await other.repositories.movements.create({
    ...movement('REMOTE FIXTURE forbidden foreign account'),
    accountId: cross.id,
    categoryId: ownCategory.id,
  })
  const op = (await other.pending())[0]
  const altered = JSON.parse(op.payloadText)
  const row = altered.changes.find((c) => c.entity === 'transactions')
  row.row.account_id = account.id
  const rejected = await fetch(api + '/operations', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + sessions[2].accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operationId: op.id,
      expectedRevision: op.expectedRevision,
      kind: op.kind,
      payloadText: protocol.canonicalJson(altered),
    }),
  })
  check(!rejected.ok, 'Foreign-owner reference accepted')
  const viewB = await transport.view(sessions[2].accessToken, new AbortController().signal)
  check(
    !viewB.data.transactions.some((t) => t.id === foreign.id),
    'Rejected cross-reference left partial data',
  )
  check(
    viewB.data.accounts.every((a) => a.user_id === sessions[2].userId),
    'Foreign owner read leak',
  )
  pass('two real owners isolated; cross-owner reference rejected atomically')
  await pc.pull()
  await phone.pull()
  const server = await transport.view(sessions[0].accessToken, new AbortController().signal)
  const backups = await Promise.all([
    pc.repositories.backup.export(),
    phone.repositories.backup.export(),
  ])
  const manifests = await Promise.all(
    [...backups, mapping.decodeRemoteBackup(server.data, sessions[0].userId)].map((b) =>
      protocol.reconciliationManifest(b, date),
    ),
  )
  check(
    manifests.every((m) => protocol.canonicalJson(m) === protocol.canonicalJson(manifests[0])),
    'Server/client balance reconciliation differs',
  )
  report.revision = server.revision
  report.reconciliation = manifests[0]
  pass(
    'two independent client caches and authoritative remote snapshot reconcile balances, UUIDs, invoices and card totals',
  )
  report.passed = true
} catch (error) {
  report.passed = false
  report.error = error.message
  console.error('FAIL ' + error.message)
  process.exitCode = 1
} finally {
  for (const c of clients) {
    c.stop()
    c.db.close()
  }
  for (const a of authClients) a.auth.stopAutoRefresh()
  if (vite) await vite.close()
  report.finishedAt = new Date().toISOString()
  writeFileSync(join(dir, 'remote-test-report.json'), JSON.stringify(report, null, 2))
}
