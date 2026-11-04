import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
/* global AbortController */

/** Uses the SAME workspace factory injected into App, not SyncLabPage's adapter. */
export async function testApplicationSyncFlow({ vite, session, workerUrl, databases, pass }) {
  const { createApplicationSyncWorkspace } = await vite.ssrLoadModule(
    '/src/infrastructure/sync/application-workspace.ts',
  )
  const { localWorkerTransport } = await vite.ssrLoadModule('/src/infrastructure/sync/outbox.ts')
  const protocol = await vite.ssrLoadModule('/src/infrastructure/sync/protocol.ts')
  const mapping = await vite.ssrLoadModule('/src/infrastructure/supabase/mapping.ts')
  const baseTransport = localWorkerTransport(workerUrl)
  let offline = false,
    loseResponse = false
  const transport = {
    ...baseTransport,
    async send(...args) {
      if (offline) throw new TypeError('Synthetic offline application transport')
      const receipt = await baseTransport.send(...args)
      if (loseResponse) {
        loseResponse = false
        throw new TypeError('Synthetic response lost after application commit')
      }
      return receipt
    },
  }
  const runId = randomUUID()
  const open = async (deviceId, port = transport) => {
    const workspace = createApplicationSyncWorkspace(
      {
        enabled: true,
        development: true,
        appOrigin: 'http://127.0.0.1:5173',
        projectUrl: 'http://127.0.0.1:54321',
        workerUrl,
        userId: session.userId,
        runId,
        deviceId,
        asOf: '2026-11-04',
      },
      () => session,
      port,
    )
    databases.push(workspace.client.db)
    await workspace.initialize()
    return workspace
  }
  let a = await open('app-pc'),
    b = await open('app-phone', baseTransport)
  const sync = async () => {
    await a.client.drain()
    await b.client.pull()
  }
  const assert = (value, message) => {
    if (!value) throw new Error(message)
  }
  const income = await a.repositories.categories.create({
    name: 'Receita do aplicativo',
    direction: 'income',
    color: 'sage',
    icon: 'wallet',
  })
  const expense = await a.repositories.categories.create({
    name: 'Despesa do aplicativo',
    direction: 'expense',
    color: 'rose',
    icon: 'coffee',
  })
  const account = await a.repositories.accounts.create({
    name: 'Conta principal do aplicativo',
    institution: 'Homologação local',
    type: 'checking',
    openingBalanceCents: 0,
    openingDate: '2026-01-01',
    color: 'sage',
  })
  const movement = (description, amountCents = 100, direction = 'expense') => ({
    kind: 'transaction',
    accountId: account.id,
    categoryId: direction === 'income' ? income.id : expense.id,
    description,
    amountCents,
    direction,
    method: 'pix',
    date: '2026-02-01',
    status: 'settled',
    settledDate: '2026-02-01',
  })
  await a.repositories.movements.create(movement('Receita recebida no aplicativo', 10000, 'income'))
  const cardInput = {
    accountId: account.id,
    name: 'Cartão do aplicativo',
    institution: 'Homologação',
    nickname: '',
    brand: '',
    lastFour: '',
    color: 'sage',
    limitCents: 20000,
    closingDay: 5,
    dueDay: 15,
  }
  const card = await a.repositories.credit.createCard(cardInput)
  const purchaseInput = {
    cardId: card.id,
    categoryId: expense.id,
    description: 'Compra parcelada do aplicativo',
    amountCents: 1200,
    installmentCount: 3,
    feeCents: 0,
    date: '2026-02-02',
  }
  const purchase = await a.repositories.credit.createPurchase(purchaseInput)
  const invoice = (await a.repositories.invoices.list()).find((i) => i.period === '2026-02')
  const payment = await a.repositories.credit.pay({
    invoiceId: invoice.id,
    accountId: account.id,
    amountCents: 400,
    date: '2026-02-10',
  })
  await sync()
  assert(
    (await b.repositories.installments.list()).length === 3 &&
      (await b.repositories.payments.list()).length === 1,
    'Application flow did not replicate purchase/payment',
  )
  pass(
    'main application workspace services create account, income, card, installments and invoice payment with atomic outbox and replication',
  )
  await a.repositories.credit.correctPayment(payment.id, {
    invoiceId: invoice.id,
    accountId: account.id,
    amountCents: 300,
    date: '2026-02-10',
    notes: 'Correção explícita do aplicativo',
  })
  await sync()
  assert(
    (await b.repositories.payments.get(payment.id)).amountCents === 300,
    'Audited payment correction failed',
  )
  const history = (await a.repositories.backup.export()).data.audit.filter(
    (e) => e.entityId === payment.id,
  )
  assert(
    history.some(
      (e) => e.action === 'update' && e.before.amountCents === 400 && e.after.amountCents === 300,
    ),
    'Original payment amount lost from immutable audit',
  )
  await a.repositories.credit.refundPurchase(
    purchase.id,
    100,
    '2026-02-11',
    'Estorno parcial do aplicativo',
  )
  await sync()
  await a.repositories.credit.refundPurchase(
    purchase.id,
    1100,
    '2026-02-12',
    'Estorno do restante da compra',
  )
  await sync()
  await a.repositories.credit.reversePayment(
    payment.id,
    '2026-02-13',
    'Estorno explícito do pagamento',
  )
  await sync()
  const creditInvoice = (await a.repositories.invoices.list()).find(i => i.period === '2026-03')
  await a.repositories.credit.applyCredit(creditInvoice.id, invoice.id, 300)
  await sync()
  const cancellable = await a.repositories.credit.createPurchase({
    ...purchaseInput,
    amountCents: 200,
    installmentCount: 1,
    date: '2026-05-01',
  })
  await sync()
  await a.repositories.credit.cancelPurchase(cancellable.id, 'Cancelamento sem liquidação')
  await sync()
  pass(
    'main application preserves payment correction audit, partial/full refunds, payment reversal, paired invoice credit and cancellation without settlement',
  )
  const reserve = await a.repositories.accounts.create({
    name: 'Reserva do aplicativo',
    institution: 'Homologação',
    type: 'savings',
    openingBalanceCents: 0,
    openingDate: '2026-01-01',
    color: 'blue',
  })
  await a.repositories.movements.create({
    ...movement('Transferência do aplicativo', 500),
    kind: 'transfer',
    destinationAccountId: reserve.id,
  })
  const adjustment = await a.repositories.movements.create({
    ...movement('Ajuste do aplicativo', 200, 'income'),
    kind: 'adjustment',
    method: 'other',
  })
  await sync()
  await a.repositories.movements.update('adjustment', adjustment.id, {
    ...movement('Ajuste corrigido do aplicativo', 250, 'income'),
    kind: 'adjustment',
    method: 'other',
  })
  await sync()
  const recurringInput = {
    accountId: account.id,
    categoryId: income.id,
    description: 'Recorrência do aplicativo',
    direction: 'income',
    amountCents: 25,
    startDate: '2026-03-01',
    dayOfMonth: 1,
    frequency: 'monthly',
  }
  const recurring = await a.repositories.planning.saveRecurring(recurringInput)
  await a.repositories.planning.realize(recurring.id, '2026-03-01', 25, '2026-03-01')
  await sync()
  await a.repositories.planning.status(recurring.id, 'paused')
  await a.repositories.planning.saveRecurring({ ...recurringInput, amountCents: 30 }, recurring.id)
  await a.repositories.planning.status(recurring.id, 'ended')
  await a.repositories.planning.saveBudget('2026-02', expense.id, 500)
  await sync()
  await a.repositories.planning.removeBudget((await a.client.db.budgets.toArray())[0].id)
  const unused = await a.repositories.accounts.create({
    name: 'Conta descartável fictícia',
    institution: 'Homologação',
    type: 'cash',
    openingBalanceCents: 0,
    openingDate: '2026-01-01',
    color: 'amber',
  })
  await a.repositories.accounts.remove(unused.id)
  await a.repositories.credit.archiveCard(card.id, true)
  await sync()
  await a.repositories.credit.archiveCard(card.id, false)
  await sync()
  assert(
    (await b.repositories.recurring.get(recurring.id)).ended &&
      (await b.repositories.snapshot()).occurrences.length === 1,
    'Recurring edit changed a realized historical occurrence',
  )
  pass(
    'main application transfer, adjustment correction, recurring edits, budget tombstones, unused-account deletion and card archive converge',
  )
  offline = true
  const offlineExpense = await a.repositories.movements.create(
    movement('Despesa offline do aplicativo'),
  )
  await a.client.flush().then(
    () => {
      throw new Error('Offline fault not applied')
    },
    () => {},
  )
  const pendingId = (await a.client.pending())[0].id
  a.close()
  a = await open('app-pc')
  assert(
    (await a.client.pending())[0].id === pendingId,
    'Application reload replaced operation identity',
  )
  offline = false
  await setTimeout(1100)
  await sync()
  assert(
    (await b.repositories.transactions.list()).filter((t) => t.id === offlineExpense.id).length ===
      1,
    'Offline operation duplicated',
  )
  loseResponse = true
  await a.repositories.movements.create(movement('Resposta perdida do aplicativo', 1))
  await a.client.flush().then(
    () => {
      throw new Error('Response-loss fault not applied')
    },
    () => {},
  )
  a.close()
  a = await open('app-pc')
  await setTimeout(1100)
  await sync()
  pass(
    'main application workspace survives reload offline and after a lost commit response without duplicate financial entries',
  )
  const editableInput = {
    ...purchaseInput,
    date: '2026-08-01',
    amountCents: 600,
    installmentCount: 2,
  }
  const editable = await a.repositories.credit.createPurchase(editableInput)
  await sync()
  await a.repositories.credit.updatePurchase(editable.id, {
    ...editableInput,
    amountCents: 700,
    description: 'PC concorrente no aplicativo',
  })
  await b.repositories.credit.updatePurchase(editable.id, {
    ...editableInput,
    amountCents: 700,
    description: 'Celular concorrente no aplicativo',
  })
  const race = await Promise.allSettled([a.client.flush(), b.client.flush()])
  assert(
    race.filter((r) => r.status === 'fulfilled').length === 1,
    'Application concurrency lost CAS isolation',
  )
  const loser = race[0].status === 'rejected' ? a : b,
    winner = loser === a ? b : a
  await loser.repositories.planning.saveBudget('2026-08', expense.id, 100)
  const ids = (await loser.client.pending()).map((op) => op.id)
  await loser.client.flush()
  assert(
    (await loser.client.pending()).length === 2,
    'Conflict dependent operation was not blocked',
  )
  await loser.client.resolveUsingServer('USAR VERSÃO DO SERVIDOR')
  await loser.client.drain()
  await winner.client.pull()
  assert(
    (await loser.client.db.outbox.bulkGet(ids)).every((op) => op.state === 'archived'),
    'Conflict history was deleted instead of archived',
  )
  a.close()
  a = await open('app-pc')
  await a.client.pull()
  await b.client.pull()
  const remote = await baseTransport.view(session.accessToken, new AbortController().signal)
  const manifests = await Promise.all(
    [
      a.repositories.backup.export(),
      b.repositories.backup.export(),
      Promise.resolve(mapping.decodeRemoteBackup(remote.data, session.userId)),
    ].map(async (backup) => protocol.reconciliationManifest(await backup, '2026-11-04')),
  )
  assert(
    manifests.every((m) => protocol.canonicalJson(m) === protocol.canonicalJson(manifests[0])),
    'Application clients and PostgreSQL do not reconcile',
  )
  const result = { revision: remote.revision, manifest: manifests[0] }
  a.close()
  b.close()
  pass(
    'main application conflict resolution archives dependent operations and full financial reconciliation persists across workspace restart',
  )
  return result
}
