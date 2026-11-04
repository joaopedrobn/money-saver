import { expect, it } from 'vitest'
import { FinancialDatabase, db } from './database'
import { financialDatabaseName, getFinancialWorkspace } from './financial-context'
import type { AccountInput } from '@/domain/models'

it('keeps anonymous and account data separate, survives re-entry, and binds delayed operations to their original account', async () => {
  const projectUrl = `https://${crypto.randomUUID()}.supabase.co`
  const a = { projectUrl, userId: 'a' },
    b = { projectUrl, userId: 'b' }
  const anonymous = getFinancialWorkspace(null).repositories
  const first = getFinancialWorkspace(a).repositories
  const second = getFinancialWorkspace(b).repositories
  const input: AccountInput = {
    name: 'Sem conta',
    institution: 'Banco de teste',
    type: 'checking',
    openingBalanceCents: 100,
    openingDate: '2026-01-01',
    color: 'sage',
  }
  try {
    const localAccount = await anonymous.accounts.create(input)
    expect(await first.accounts.list()).toEqual([])
    expect(await second.accounts.list()).toEqual([])
    const accountA = await first.accounts.create({ ...input, name: 'Conta A' })
    // Hold the operation's repository, switch to B, then complete the old A operation.
    const delayed = () => first.accounts.update(accountA.id, { ...input, name: 'Atualizada em A' })
    expect(getFinancialWorkspace(b).repositories).toBe(second)
    await delayed()
    expect(await second.accounts.list()).toEqual([])
    expect(await anonymous.accounts.get(localAccount.id)).toEqual(localAccount)
    expect(getFinancialWorkspace(a).repositories).toBe(first)
    expect((await first.accounts.list()).map((row) => row.name)).toEqual(['Atualizada em A'])
    expect(financialDatabaseName({ ...a, projectUrl: 'https://other.supabase.co' })).not.toBe(
      financialDatabaseName(a),
    )
    const reloaded = new FinancialDatabase(financialDatabaseName(a))
    expect((await reloaded.accounts.get(accountA.id))?.name).toBe('Atualizada em A')
    reloaded.close()
  } finally {
    // fake-indexeddb only; no browser's financial databases are opened by this test.
    await db.delete()
    await new FinancialDatabase(financialDatabaseName(a)).delete()
    await new FinancialDatabase(financialDatabaseName(b)).delete()
  }
})
