import { useContext } from 'react'
import { SyncSettingsContext } from '@/features/settings/sync-settings-context'

export function StorageNotice({ local }: { local: boolean }) {
  const sync = useContext(SyncSettingsContext)
  return (
    <p>
      {sync
        ? 'Réplica IndexedDB desta conta com outbox e Supabase. Confira confirmações e conflitos em Configurações.'
        : local
          ? 'Espaço sem conta: dados compartilhados por quem usa este perfil de navegador, sem vínculo com a conta conectada.'
          : 'Dados salvos somente neste navegador, em um espaço local separado por conta. Nenhum dado financeiro foi enviado à nuvem.'}
    </p>
  )
}
