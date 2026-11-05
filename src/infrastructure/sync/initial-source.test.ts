import { expect, it } from 'vitest'
import { hasUnsentLocalData } from './initial-source'
import { fixture } from './fixtures.test-data'
import { defaultCategories } from '@/domain/default-categories'
import { validateBackup,type Backup } from '@/domain/backup'

const empty = (): Backup => ({
  ...fixture(),
  data: Object.fromEntries(Object.keys(fixture().data).map((e) => [e, []])) as unknown as Backup['data'],
})
it('opens a fresh cloud replica normally when the old namespace is empty or contains only default seeds', () => {
  const backup = empty()
  expect(hasUnsentLocalData(backup)).toBe(false)
  backup.data.categories = validateBackup({...backup,data:{...backup.data,categories:defaultCategories()}}).data.categories
  expect(hasUnsentLocalData(backup)).toBe(false)
  backup.data.categories[0].updatedAt = new Date().toISOString()
  expect(hasUnsentLocalData(backup)).toBe(false)
})
it('requires explicit source review for financial records or customized categories without changing them', () => {
  const backup = fixture(),
    before = JSON.stringify(backup)
  expect(hasUnsentLocalData(backup)).toBe(true)
  expect(JSON.stringify(backup)).toBe(before)
  const categoriesOnly = empty()
  categoriesOnly.data.categories = validateBackup({...categoriesOnly,data:{...categoriesOnly.data,categories:defaultCategories()}}).data.categories
  categoriesOnly.data.categories[0].name = 'Categoria personalizada'
  expect(hasUnsentLocalData(categoriesOnly)).toBe(true)
})
