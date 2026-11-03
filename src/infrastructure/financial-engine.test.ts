import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { FinancialDatabase } from './database'
import { DexieAccountRepository } from './repositories'
import {
  DexieMovementRepository,
  DexieCategoryRepository,
  readSnapshot,
} from './movement-repository'
import { DexieBackupRepository } from './backup-repository'
import {
  balancesAt,
  monthlySummary,
  statement,
  filterMovements,
  movementKey,
} from '@/domain/finance'
import { sumCents } from '@/domain/money'
import type { BankAccount, MovementInput, Category, CivilDate } from '@/domain/models'
let d: FinancialDatabase,
  accounts: DexieAccountRepository,
  movements: DexieMovementRepository,
  categories: DexieCategoryRepository,
  backups: DexieBackupRepository
let a: BankAccount, b: BankAccount, incomeCategory: Category, expenseCategory: Category
const cutoff: CivilDate = '2026-11-03'
beforeEach(async () => {
  d = new FinancialDatabase(`engine-${crypto.randomUUID()}`)
  accounts = new DexieAccountRepository(d)
  movements = new DexieMovementRepository(d)
  categories = new DexieCategoryRepository(d)
  backups = new DexieBackupRepository(d)
  a = await accounts.create({
    name: 'Nubank',
    institution: 'Banco A',
    type: 'checking',
    openingBalanceCents: 300000,
    openingDate: '2026-01-01',
    color: 'sage',
  })
  b = await accounts.create({
    name: 'Itaú',
    institution: 'Banco B',
    type: 'checking',
    openingBalanceCents: 100000,
    openingDate: '2026-01-01',
    color: 'blue',
  })
  const seeded = await categories.list()
  incomeCategory = seeded.find((c) => c.direction === 'income')!
  expenseCategory = seeded.find((c) => c.direction === 'expense')!
})
afterEach(async () => {
  await d.delete()
})
function input(overrides: Partial<MovementInput> = {}): MovementInput {
  return {
    kind: 'transaction',
    accountId: a.id,
    categoryId: expenseCategory.id,
    description: 'Compra no débito',
    amountCents: 15000,
    direction: 'expense',
    method: 'debit',
    date: '2026-01-05',
    status: 'settled',
    settledDate: '2026-01-05',
    ...overrides,
  }
}
async function balances() {
  return balancesAt(await readSnapshot(d), cutoff)
}
describe('financial engine and repository integrity', () => {
  it('income increases bank balance without changing opening balance', async () => {
    await movements.create(
      input({ direction: 'income', categoryId: incomeCategory.id, amountCents: 400000 }),
    )
    expect((await balances())[a.id]).toBe(700000)
    expect((await accounts.get(a.id))?.openingBalanceCents).toBe(300000)
  })
  it('expense decreases bank balance', async () => {
    await movements.create(input())
    expect((await balances())[a.id]).toBe(285000)
  })
  it('Pix sent, salary received and debit expense reproduce R$ 6.650', async () => {
    await movements.create(input({ amountCents: 20000, method: 'pix', description: 'Pix enviado' }))
    await movements.create(
      input({
        amountCents: 400000,
        direction: 'income',
        categoryId: incomeCategory.id,
        description: 'Salário recebido',
      }),
    )
    await movements.create(input())
    expect((await balances())[a.id]).toBe(665000)
  })
  it('Pix received preserves cent precision', async () => {
    await movements.create(
      input({
        direction: 'income',
        categoryId: incomeCategory.id,
        amountCents: 12345,
        method: 'pix',
      }),
    )
    expect((await balances())[a.id]).toBe(312345)
  })
  it('a transfer moves both sides without changing consolidated wealth or income/expense', async () => {
    const before = sumCents(Object.values(await balances()))
    const t = await movements.create(
      input({
        kind: 'transfer',
        destinationAccountId: b.id,
        categoryId: undefined,
        amountCents: 50000,
      }),
    )
    expect((await balances())[a.id]).toBe(250000)
    expect((await balances())[b.id]).toBe(150000)
    expect(sumCents(Object.values(await balances()))).toBe(before)
    expect(await d.transfers.count()).toBe(1)
    expect(await d.transactions.count()).toBe(0)
    expect(t.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(monthlySummary(await readSnapshot(d), new Date(2026, 0, 1), cutoff)).toMatchObject({
      income: 0,
      expense: 0,
      net: 0,
    })
  })
  it('edits amount, direction and account by recalculating history', async () => {
    const tx = await movements.create(input())
    await movements.update(tx.kind, tx.id, input({ accountId: b.id, amountCents: 2345 }))
    expect((await balances())[a.id]).toBe(300000)
    expect((await balances())[b.id]).toBe(97655)
    expect(await d.transactions.count()).toBe(1)
  })
  it('deletion restores balance and retains audit history', async () => {
    const tx = await movements.create(input())
    await movements.remove(tx.kind, tx.id)
    expect((await balances())[a.id]).toBe(300000)
    expect(await d.audit.where('entityId').equals(tx.id).count()).toBe(2)
  })
  it.each(['planned', 'pending', 'cancelled'] as const)(
    '%s does not affect realized balance',
    async (status) => {
      await movements.create(input({ status, settledDate: undefined, date: '2026-12-10' }))
      expect((await balances())[a.id]).toBe(300000)
    },
  )
  it('settles future commitment on actual payment date, only once', async () => {
    const tx = await movements.create(
      input({ status: 'pending', date: '2026-12-10', settledDate: undefined }),
    )
    await movements.settle(tx.kind, tx.id, '2026-02-01')
    expect(balancesAt(await readSnapshot(d), '2026-01-31')[a.id]).toBe(300000)
    expect(balancesAt(await readSnapshot(d), '2026-02-01')[a.id]).toBe(285000)
    await expect(movements.settle(tx.kind, tx.id, '2026-02-01')).rejects.toThrow('Somente')
    expect(await d.transactions.count()).toBe(1)
  })
  it('allows negative balances', async () => {
    await movements.create(input({ amountCents: 300001 }))
    expect((await balances())[a.id]).toBe(-1)
  })
  it('adjustments change balance but not income/expense', async () => {
    const m = await movements.create(
      input({ kind: 'adjustment', amountCents: 123, direction: 'expense' }),
    )
    expect((await balances())[a.id]).toBe(299877)
    expect(monthlySummary(await readSnapshot(d), new Date(2026, 0, 1), cutoff).expense).toBe(0)
    await movements.update(
      m.kind,
      m.id,
      input({
        kind: 'adjustment',
        amountCents: 222,
        direction: 'income',
        categoryId: incomeCategory.id,
      }),
    )
    expect((await balances())[a.id]).toBe(300222)
    await movements.remove(m.kind, m.id)
    expect((await balances())[a.id]).toBe(300000)
  })
  it('transfer editing and deletion are a single operation', async () => {
    const m = await movements.create(
      input({ kind: 'transfer', destinationAccountId: b.id, amountCents: 50000 }),
    )
    await movements.update(
      'transfer',
      m.id,
      input({ kind: 'transfer', accountId: b.id, destinationAccountId: a.id, amountCents: 125 }),
    )
    expect(await balances()).toMatchObject({ [a.id]: 300125, [b.id]: 99875 })
    await movements.remove('transfer', m.id)
    expect(await balances()).toMatchObject({ [a.id]: 300000, [b.id]: 100000 })
  })
  it('pending/cancelled transfers and adjustments do not change any balance', async () => {
    await movements.create(
      input({
        kind: 'transfer',
        destinationAccountId: b.id,
        status: 'pending',
        settledDate: undefined,
      }),
    )
    await movements.create(
      input({ kind: 'adjustment', status: 'cancelled', settledDate: undefined }),
    )
    expect(await balances()).toMatchObject({ [a.id]: 300000, [b.id]: 100000 })
  })
  it('rejects missing accounts, incompatible categories and same-account transfers', async () => {
    await expect(movements.create(input({ accountId: 'missing' }))).rejects.toThrow('Conta')
    await expect(movements.create(input({ categoryId: 'missing' }))).rejects.toThrow('Categoria')
    await expect(movements.create(input({ categoryId: incomeCategory.id }))).rejects.toThrow(
      'Categoria',
    )
    await expect(
      movements.create(input({ kind: 'transfer', destinationAccountId: a.id })),
    ).rejects.toThrow()
    expect(await d.transactions.count()).toBe(0)
  })
  it('blocks invalid money, malformed dates, future settlements and pre-opening operations', async () => {
    for (const amountCents of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, NaN])
      await expect(movements.create(input({ amountCents }))).rejects.toThrow()
    for (const date of ['2026-02-30', '2025-12-31'] as CivilDate[])
      await expect(movements.create(input({ date }))).rejects.toThrow()
    await expect(movements.create(input({ settledDate: '2099-01-01' }))).rejects.toThrow()
    await expect(movements.create(input({ settledDate: '2025-12-31' }))).rejects.toThrow()
    expect(await d.transactions.count()).toBe(0)
  })
  it('archiving retains references and blocks new records but allows editing existing history', async () => {
    const m = await movements.create(input())
    await categories.archive(expenseCategory.id, true)
    await expect(movements.create(input())).rejects.toThrow('arquivada')
    await expect(
      movements.update(m.kind, m.id, input({ amountCents: 200 })),
    ).resolves.toMatchObject({ amountCents: 200 })
    await expect(accounts.remove(a.id)).rejects.toThrow('vínculos')
    await categories.archive(expenseCategory.id, false)
    await expect(movements.create(input())).resolves.toBeDefined()
  })
  it('category name/icon/color can be edited but group and duplicate names are protected', async () => {
    const created = await categories.create({
      name: 'Meu curso',
      direction: 'expense',
      color: 'blue',
      icon: 'book',
    })
    await categories.update(created.id, {
      ...created,
      name: 'Curso atualizado',
      icon: 'gift',
      color: 'purple',
    })
    expect(await categories.get(created.id)).toMatchObject({
      name: 'Curso atualizado',
      icon: 'gift',
      color: 'purple',
    })
    await expect(
      categories.update(created.id, { ...created, direction: 'income' }),
    ).rejects.toThrow('grupo')
    await expect(
      categories.create({
        name: expenseCategory.name,
        direction: 'expense',
        color: 'sage',
        icon: 'tag',
      }),
    ).rejects.toThrow('Já existe')
  })
  it('persists movements and categories after reopening the database', async () => {
    const tx = await movements.create(input())
    const name = d.name
    d.close()
    d = new FinancialDatabase(name)
    movements = new DexieMovementRepository(d)
    expect((await movements.list()).find((m) => m.id === tx.id)).toMatchObject({
      amountCents: 15000,
    })
    expect((await readSnapshot(d)).categories.length).toBe(15)
    expect((await balances())[a.id]).toBe(285000)
  })
  it('rolls back financial write when its audit fails', async () => {
    d.audit.hook('creating', () => {
      throw new Error('audit failure')
    })
    await expect(
      movements.create(input({ kind: 'transfer', destinationAccountId: b.id })),
    ).rejects.toThrow('audit failure')
    expect(await d.transfers.count()).toBe(0)
    expect(await balances()).toMatchObject({ [a.id]: 300000, [b.id]: 100000 })
  })
  it('failed edits leave both transfer sides and audit unchanged', async () => {
    const t = await movements.create(input({ kind: 'transfer', destinationAccountId: b.id }))
    const auditCount = await d.audit.count()
    d.audit.hook('creating', () => {
      throw new Error('audit failure')
    })
    await expect(
      movements.update(
        t.kind,
        t.id,
        input({ kind: 'transfer', destinationAccountId: b.id, amountCents: 999 }),
      ),
    ).rejects.toThrow()
    expect((await d.transfers.get(t.id))?.amountCents).toBe(15000)
    expect(await d.audit.count()).toBe(auditCount)
  })
  it('statement uses deterministic same-date ordering and running balances before filters', async () => {
    const x = await movements.create(input({ description: 'Primeira', amountCents: 100 })),
      y = await movements.create(input({ description: 'Segunda', amountCents: 200 }))
    await d.transactions.update(x.id, { createdAt: '2026-01-01T00:00:00.000Z' })
    await d.transactions.update(y.id, { createdAt: '2026-01-01T00:00:00.001Z' })
    const rows = statement(await readSnapshot(d), a.id, cutoff)
    expect(rows.map((r) => r.balance)).toEqual([299900, 299700])
    const filtered = filterMovements(
      rows.map((r) => r.movement),
      {
        search: 'SEGUNDA',
        from: '2026-01-01',
        to: '2026-01-31',
        categoryId: expenseCategory.id,
        type: 'expense',
      },
    )
    expect(filtered).toHaveLength(1)
    expect(rows.find((r) => movementKey(r.movement) === movementKey(filtered[0]))?.balance).toBe(
      299700,
    )
    expect(rows.at(-1)?.balance).toBe((await balances())[a.id])
  })
  it('monthly indicators use actual settlement date and exclude cancellation', async () => {
    await movements.create(input({ date: '2026-01-10', settledDate: '2026-02-01' }))
    await movements.create(input({ status: 'cancelled', settledDate: undefined }))
    expect(monthlySummary(await readSnapshot(d), new Date(2026, 0, 1), cutoff).expense).toBe(0)
    expect(monthlySummary(await readSnapshot(d), new Date(2026, 1, 1), cutoff)).toMatchObject({
      expense: 15000,
      net: -15000,
      categories: [{ amountCents: 15000 }],
    })
  })
})
describe('versioned backup', () => {
  it('exports, previews and restores all financial data with recalculated balances', async () => {
    const tx = await movements.create(input())
    const backup = await backups.export()
    expect(backup.version).toBe(2)
    expect(backups.preview(JSON.parse(JSON.stringify(backup))).data.transactions).toHaveLength(1)
    await movements.remove(tx.kind, tx.id)
    await backups.restore(backup, 'RESTAURAR')
    expect((await balances())[a.id]).toBe(285000)
    expect(await d.transactions.get(tx.id)).toBeDefined()
    expect((await d.audit.toArray()).filter((event) => event.entityType === 'backup')).toHaveLength(
      1,
    )
  })
  it('never overwrites without exact confirmation', async () => {
    const backup = await backups.export()
    await movements.create(input())
    await expect(backups.restore(backup, '')).rejects.toThrow('Confirme')
    expect(await d.transactions.count()).toBe(1)
  })
  it('rejects duplicate IDs, orphan references and invalid monetary values without touching local data', async () => {
    await movements.create(input())
    const backup = await backups.export()
    const duplicate = structuredClone(backup)
    duplicate.data.accounts.push(duplicate.data.accounts[0])
    expect(() => backups.preview(duplicate)).toThrow('duplicados')
    const orphan = structuredClone(backup)
    orphan.data.accounts = []
    await expect(backups.restore(orphan, 'RESTAURAR')).rejects.toThrow('conta')
    const fractional = structuredClone(backup)
    fractional.data.transactions[0].amountCents = 1.2
    expect(() => backups.preview(fractional)).toThrow()
    expect(await d.transactions.count()).toBe(1)
  })
  it('restoration rolls back clears and writes if any write fails', async () => {
    const backup = await backups.export()
    const tx = await movements.create(input())
    d.audit.hook('creating', () => {
      throw new Error('restore failure')
    })
    await expect(backups.restore(backup, 'RESTAURAR')).rejects.toThrow()
    expect(await d.transactions.get(tx.id)).toBeDefined()
    expect(await d.accounts.count()).toBe(2)
  })
  it('accepts phase-one v1 backups and validates the schema version', async () => {
    const backup = await backups.export()
    const old = { version: 1, exportedAt: backup.exportedAt, data: backup.data }
    expect(backups.preview(old).version).toBe(1)
    await backups.restore(old, 'RESTAURAR')
    expect(await d.accounts.count()).toBe(2)
    expect(() => backups.preview({ ...old, version: 99 })).toThrow()
  })
})
describe('IndexedDB v1 to v2 migration', () => {
  it('preserves existing accounts and movements, normalizes settlement dates and seeds categories once', async () => {
    const name = `migration-${crypto.randomUUID()}`,
      legacy = new Dexie(name)
    legacy.version(1).stores({
      accounts: 'id, name, createdAt',
      cards: 'id, accountId',
      transactions: 'id, accountId, categoryId, date, status',
      purchases: 'id, cardId, date',
      installments: 'id, purchaseId, invoiceId',
      invoices: 'id, cardId, [cardId+period]',
      payments: 'id, invoiceId, accountId',
      recurring: 'id, accountId',
      categories: 'id, direction',
      transfers: 'id, sourceAccountId, destinationAccountId',
      adjustments: 'id, accountId',
      settings: 'id',
      audit: 'id, entityId, at',
    })
    await legacy.open()
    await legacy.table('accounts').bulkAdd([a, b])
    const customCategory = { ...incomeCategory, id: crypto.randomUUID(), name: 'Receita legada' }
    await legacy.table('categories').add(customCategory)
    const oldTransaction = {
      id: crypto.randomUUID(),
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      accountId: a.id,
      categoryId: customCategory.id,
      description: 'Recebimento antigo',
      amountCents: 200,
      direction: 'income',
      method: 'pix',
      date: '2026-01-05',
      status: 'settled',
    }
    await legacy.table('transactions').add(oldTransaction)
    await legacy.table('transfers').add({
      id: crypto.randomUUID(),
      sourceAccountId: a.id,
      destinationAccountId: b.id,
      amountCents: 100,
      date: '2026-01-05',
      description: 'Transferência antiga',
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    })
    legacy.close()
    const upgraded = new FinancialDatabase(name)
    try {
      await upgraded.open()
      expect(await upgraded.accounts.get(a.id)).toEqual(a)
      expect((await upgraded.transfers.toArray())[0]).toMatchObject({
        status: 'settled',
        settledDate: '2026-01-05',
      })
      expect(await upgraded.categories.count()).toBe(16)
      expect(await upgraded.categories.get(customCategory.id)).toEqual(customCategory)
      expect(await upgraded.transactions.get(oldTransaction.id)).toMatchObject({
        ...oldTransaction,
        settledDate: '2026-01-05',
      })
      expect(balancesAt(await readSnapshot(upgraded), cutoff)[a.id]).toBe(300100)
      upgraded.close()
      await upgraded.open()
      expect(await upgraded.categories.count()).toBe(16)
    } finally {
      await upgraded.delete()
    }
  })
})
