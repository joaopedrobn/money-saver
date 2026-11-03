import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FinancialDatabase } from './database'
import { DexieAccountRepository } from './repositories'
import type { AccountInput } from '@/domain/models'
let database: FinancialDatabase
let repository: DexieAccountRepository
const input: AccountInput = {
  name: 'Principal',
  institution: 'Meu banco',
  type: 'checking',
  openingBalanceCents: 123456,
  openingDate: '2026-01-01',
  color: 'sage',
}
beforeEach(() => {
  database = new FinancialDatabase(`test-${crypto.randomUUID()}`)
  repository = new DexieAccountRepository(database)
})
afterEach(async () => {
  await database.delete()
})
describe('IndexedDB account repository', () => {
  it('creates UUID accounts and persists across connection reloads', async () => {
    const account = await repository.create(input)
    expect(account.id).toMatch(/^[0-9a-f-]{36}$/)
    const name = database.name
    database.close()
    database = new FinancialDatabase(name)
    repository = new DexieAccountRepository(database)
    expect(await repository.get(account.id)).toEqual(account)
    expect(await repository.list()).toHaveLength(1)
  })
  it('updates and deletes with traceable before/after history', async () => {
    const account = await repository.create(input)
    await repository.update(account.id, { ...input, name: 'Atualizada', openingBalanceCents: -100 })
    expect((await repository.get(account.id))?.openingBalanceCents).toBe(-100)
    await repository.remove(account.id)
    expect(await repository.list()).toEqual([])
    const audit = await database.audit.where('entityId').equals(account.id).toArray()
    expect(audit.map((e) => e.action).sort()).toEqual(['create', 'delete', 'update'])
    expect(audit.find((e) => e.action === 'update')?.before?.name).toBe('Principal')
  })
  it('blocks deletion when financial references exist', async () => {
    const account = await repository.create(input)
    await database.cards.add({
      id: 'card',
      accountId: account.id,
      name: 'Cartão',
      limitCents: 5000,
      closingDay: 5,
      dueDay: 12,
      createdAt: '',
      updatedAt: '',
    })
    await expect(repository.remove(account.id)).rejects.toThrow('vínculos')
    expect(await repository.get(account.id)).toBeDefined()
  })
  it('blocks opening balance edits when account has movements', async () => {
    const account = await repository.create(input)
    await database.adjustments.add({
      id: 'adjustment',
      accountId: account.id,
      deltaCents: 100,
      date: '2026-01-02',
      reason: 'Ajuste',
      createdAt: '',
      updatedAt: '',
    })
    await expect(
      repository.update(account.id, { ...input, openingBalanceCents: 0 }),
    ).rejects.toThrow('movimentações')
    await expect(
      repository.update(account.id, { ...input, name: 'Novo nome' }),
    ).resolves.toMatchObject({ name: 'Novo nome' })
  })
  it('rejects invalid writes and missing accounts', async () => {
    await expect(
      repository.create({ ...input, name: '', openingBalanceCents: 1.5 }),
    ).rejects.toThrow()
    await expect(repository.update('missing', input)).rejects.toThrow('não encontrada')
    expect(await repository.list()).toHaveLength(0)
    expect(await database.audit.count()).toBe(0)
  })
  it('rolls back the account write if audit persistence fails', async () => {
    database.audit.hook('creating', () => {
      throw new Error('Audit failure')
    })
    await expect(repository.create(input)).rejects.toThrow('Audit failure')
    expect(await repository.list()).toHaveLength(0)
  })
})
