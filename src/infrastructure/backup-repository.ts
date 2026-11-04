import type { BackupRepository } from '@/domain/repositories'
import { validateBackup, type Backup } from '@/domain/backup'
import { defaultCategories } from '@/domain/default-categories'
import type { FinancialDatabase } from './database'
import { remoteFields } from './supabase/mapping'
export class DexieBackupRepository implements BackupRepository {
  constructor(private readonly d: FinancialDatabase) {}
  async export(): Promise<Backup> {
    return this.d.transaction('r', this.d.tables, async () =>
      validateBackup({
        app: 'money-saver',
        version: 2,
        schemaVersion:
          (await this.d.recurring.count()) ||
          (await this.d.budgets.count()) ||
          (await this.d.occurrences.count())
            ? 4
            : 3,
        exportedAt: new Date().toISOString(),
        data: Object.fromEntries(
          await Promise.all(
            Object.keys(remoteFields).map(async (name) => [
              name,
              await this.d.table(name).toArray(),
            ]),
          ),
        ),
      }),
    )
  }
  preview(value: unknown) {
    return validateBackup(value)
  }
  async restore(value: unknown, confirmation: string): Promise<void> {
    if (this.d.tables.some((table) => table.name === 'outbox'))
      throw new Error(
        'Restauração do espaço sincronizado exige um fluxo de recuperação próprio. Preserve o backup e a fila.',
      )
    if (confirmation !== 'RESTAURAR')
      throw new Error('Confirme a substituição dos dados digitando RESTAURAR.')
    const backup = validateBackup(value)
    await this.d.transaction('rw', this.d.tables, async () => {
      for (const name of Object.keys(remoteFields)) {
        const table = this.d.table(name)
        await table.clear()
        await table.bulkAdd(backup.data[table.name as keyof Backup['data']])
      }
      if (!backup.data.categories.length) await this.d.categories.bulkAdd(defaultCategories())
      await this.d.audit.add({
        id: crypto.randomUUID(),
        entityId: crypto.randomUUID(),
        entityType: 'backup',
        action: 'create',
        at: new Date().toISOString(),
      })
    })
  }
}
