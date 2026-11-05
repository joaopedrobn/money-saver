import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { remoteSyncConfig, createRemoteSyncWorkspace } from './remote-workspace'
import type { RemoteIdentity } from '../supabase/session'
import { FinancialWorkspaceContext } from '../financial-context'
import { SyncSettingsContext } from '@/features/settings/sync-settings-context'
import type { SyncClient } from './outbox'
import { Button } from '@/components/ui/button'
import type { Backup } from '@/domain/backup'
import type { FinancialRepositories } from '@/domain/repositories'
import { hasUnsentLocalData } from './initial-source'
import { BackupPanel } from '@/features/backup/BackupPanel'
import { SyncSettings } from '@/features/settings/SyncSettings'
import { reconciliationManifest } from './protocol'
import { formatMoney, sumCents } from '@/domain/money'

export function RemoteFinanceProvider({
  identity,
  children,
}: {
  identity: RemoteIdentity
  children: ReactNode
}) {
  const config = identity.user
    ? remoteSyncConfig(import.meta.env, window.location.origin, identity.user.id)
    : null
  const consentKey = config ? `money-saver-sync-consent:${config.projectUrl}:${config.userId}` : ''
  const localRepositories = useContext(FinancialWorkspaceContext).repositories
  const [active, setActive] = useState(
    () => !!consentKey && localStorage.getItem(consentKey) !== 'local',
  )
  if (!config || !identity.accessToken) return children
  if (!active)
    return (
      <>
        <div className="warning-banner" role="status">
          Dados somente neste navegador. A sincronização remota controlada está disponível para esta
          conta. Nenhum registro antigo será importado automaticamente.
          <Button
            onClick={() => {
              localStorage.setItem(consentKey, 'true')
              setActive(true)
            }}
          >
            Abrir réplica da nuvem
          </Button>
        </div>
        {children}
      </>
    )
  return (
    <ActiveRemote
      key={consentKey}
      config={config}
      identity={identity}
      localRepositories={localRepositories}
      onLocal={() => {
        localStorage.setItem(consentKey, 'local')
        setActive(false)
      }}
    >
      {children}
    </ActiveRemote>
  )
}
function ActiveRemote({
  config,
  identity,
  onLocal,
  localRepositories,
  children,
}: {
  config: NonNullable<ReturnType<typeof remoteSyncConfig>>
  identity: RemoteIdentity
  onLocal: () => void
  localRepositories: FinancialRepositories
  children: ReactNode
}) {
  const { projectUrl, userId, workerUrl } = config
  const current = useRef(identity)
  useEffect(() => {
    current.current = identity
  }, [identity])
  const [client, setClient] = useState<SyncClient | null>(null),
    [error, setError] = useState('')
  const [legacy, setLegacy] = useState<{
    client: SyncClient
    backup: Backup
    preview: Awaited<ReturnType<SyncClient['inspectExternalBackup']>>
  } | null>(null)
  const [staged, setStaged] = useState<SyncClient | null>(null)
  const [exported, setExported] = useState(false),
    [saved, setSaved] = useState(false)
  useEffect(() => {
    client?.resumeAfterTokenRefresh()
  }, [client, identity.accessToken])
  // An effect owns one client lifetime, including StrictMode's effect replay.
  useEffect(() => {
    let mounted = true
    const client = createRemoteSyncWorkspace({ projectUrl, userId, workerUrl }, () => {
      const value = current.current
      return value.user && value.accessToken
        ? { userId: value.user.id, accessToken: value.accessToken }
        : null
    })
    const wake = () => {
      if (document.visibilityState !== 'hidden') client.wake()
    }
    window.addEventListener('online', wake)
    window.addEventListener('focus', wake)
    window.addEventListener('pageshow', wake)
    document.addEventListener('visibilitychange', wake)
    void (async () => {
      if (!(await client.db.syncHead.count())) {
        const backup = await localRepositories.backup.export()
        if (hasUnsentLocalData(backup)) {
          const preview = await client.inspectExternalBackup(backup)
          if (mounted) setLegacy({ client, backup, preview })
          return false
        }
      }
      await client.bootstrap()
      if ((await client.db.syncHead.get('head'))?.importStaged) {
        if (mounted) setStaged(client)
        return false
      }
      return true
    })()
      .then((ready) => {
        if (mounted && ready) {
          client.start()
          setClient(client)
        }
      })
      .catch((e: unknown) => {
        if (mounted) setError(e instanceof Error ? e.message : 'Conexão indisponível.')
      })
    return () => {
      mounted = false
      window.removeEventListener('online', wake)
      window.removeEventListener('focus', wake)
      window.removeEventListener('pageshow', wake)
      document.removeEventListener('visibilitychange', wake)
      client.stop()
      client.db.close()
    }
  }, [projectUrl, userId, workerUrl, localRepositories])
  async function chooseSource(importLocal: boolean) {
    if (!legacy || !exported || !saved) return
    setError('')
    try {
      const current = await localRepositories.backup.export()
      const manifest = await reconciliationManifest(current, legacy.preview.local.asOf)
      if (manifest.dataHash !== legacy.preview.local.dataHash)
        throw new Error('Os dados locais mudaram. Recarregue para conferir uma nova prévia.')
      await legacy.client.bootstrap()
      if (importLocal) {
        await legacy.client.stageInitialBackup(legacy.backup, 'PREPARAR IMPORTAÇÃO DE BACKUP')
        setStaged(legacy.client)
      } else {
        legacy.client.start()
        setClient(legacy.client)
      }
      setLegacy(null)
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Não foi possível preparar o espaço. Dados preservados.',
      )
    }
  }
  if (legacy) {
    const count = (m: typeof legacy.preview.local) =>
      Object.values(m.counts).reduce((a, b) => a + b, 0)
    const balance = (m: typeof legacy.preview.local) =>
      formatMoney(sumCents(Object.values(m.balances.at(-1)?.values ?? {})))
    const empty = legacy.preview.revision === 0 && count(legacy.preview.remote) === 0
    return (
      <main className="fatal">
        <h1>Confira os dados antes da primeira sincronização</h1>
        <p>
          Há registros deste navegador que ainda não foram enviados. Nenhuma mesclagem ou importação
          será automática.
        </p>
        <p>
          Neste navegador: {count(legacy.preview.local)} registros · saldo{' '}
          {balance(legacy.preview.local)}.
        </p>
        <p>
          Na nuvem: {count(legacy.preview.remote)} registros · saldo{' '}
          {balance(legacy.preview.remote)}.
        </p>
        {!empty && (
          <p>
            Os dois espaços contêm dados. A importação fica bloqueada; exporte o backup antes de
            escolher somente os dados da nuvem.
          </p>
        )}
        <BackupPanel allowRestore={false} notify={() => setExported(true)} />
        <label>
          <input
            type="checkbox"
            disabled={!exported}
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
          />
          Guardei o backup e conferi a prévia
        </label>
        {error && <p role="alert">{error}</p>}
        {empty && (
          <Button disabled={!saved} onClick={() => void chooseSource(true)}>
            Preparar importação para confirmação
          </Button>
        )}
        <Button disabled={!saved} variant="outline" onClick={() => void chooseSource(false)}>
          Usar somente a nuvem, sem mesclar
        </Button>
        <Button variant="ghost" onClick={onLocal}>
          Continuar no espaço local separado
        </Button>
      </main>
    )
  }
  if (staged)
    return (
      <main className="fatal">
        <h1>Confirme a importação após conferir o backup</h1>
        <SyncSettingsContext.Provider value={staged}>
          <SyncSettings />
        </SyncSettingsContext.Provider>
        {error && <p role="alert">{error}</p>}
        <Button
          onClick={() =>
            void (async () => {
              try {
                const state = await staged.status()
                if (state.phase !== 'verified' || state.pending)
                  throw new Error(
                    'Conclua a prévia e a confirmação de importação antes de abrir o dashboard.',
                  )
                staged.start()
                setClient(staged)
                setStaged(null)
                setError('')
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Verifique a importação.')
              }
            })()
          }
        >
          Abrir dashboard após verificação
        </Button>
        <Button variant="ghost" onClick={onLocal}>
          Voltar ao espaço local
        </Button>
      </main>
    )
  if (!client)
    return (
      <main className="fatal">
        <h1>Abrindo réplica da nuvem</h1>
        <p>{error || 'Verificando sessão e dados remotos…'}</p>
        <p>O espaço antigo deste navegador permanece separado e preservado.</p>
        <Button onClick={onLocal}>Voltar ao espaço local</Button>
      </main>
    )
  return (
    <FinancialWorkspaceContext.Provider
      value={{ repositories: client.repositories, kind: 'account' }}
    >
      <SyncSettingsContext.Provider value={client}>
        <div className="warning-banner" role="status">
          Réplica IndexedDB com sincronização Supabase controlada.
          <Button onClick={onLocal}>Usar espaço local separado</Button>
        </div>
        {children}
      </SyncSettingsContext.Provider>
    </FinancialWorkspaceContext.Provider>
  )
}
