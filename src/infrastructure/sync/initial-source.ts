import type { Backup } from '@/domain/backup'
import { defaultCategories } from '@/domain/default-categories'

/** Default seed categories are not unsent financial data. Never inspects another user's DB. */
export function hasUnsentLocalData(backup: Backup) {
  if (Object.entries(backup.data).some(([entity, rows]) => entity !== 'categories' && rows.length))
    return true
  const defaults = new Map(defaultCategories().map((c) => [c.id, c]))
  return backup.data.categories.some((category) => {
    const original = defaults.get(category.id)
    return (
      !original ||
      ['name', 'direction', 'color', 'icon', 'archived'].some(
        (key) => category[key as keyof typeof category] !== original[key as keyof typeof original],
      )
    )
  })
}
