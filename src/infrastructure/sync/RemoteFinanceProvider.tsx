import { useEffect, useRef, useState, type ReactNode } from 'react'
import { remoteSyncConfig, createRemoteSyncWorkspace } from './remote-workspace'
import type { RemoteIdentity } from '../supabase/session'
import { FinancialWorkspaceContext } from '../financial-context'
import { SyncSettingsContext } from '@/features/settings/sync-settings-context'
import type { SyncClient } from './outbox'
import { Button } from '@/components/ui/button'

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
  const [active, setActive] = useState(
    () => !!consentKey && localStorage.getItem(consentKey) === 'true',
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
      onLocal={() => {
        localStorage.removeItem(consentKey)
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
  children,
}: {
  config: NonNullable<ReturnType<typeof remoteSyncConfig>>
  identity: RemoteIdentity
  onLocal: () => void
  children: ReactNode
}) {
  const { projectUrl, userId, workerUrl } = config
  const current = useRef(identity)
  useEffect(() => {
    current.current = identity
  }, [identity])
  const [client, setClient] = useState<SyncClient | null>(null),
    [error, setError] = useState('')
  // An effect owns one client lifetime, including StrictMode's effect replay.
  useEffect(() => {
    let mounted = true
    const client = createRemoteSyncWorkspace({ projectUrl, userId, workerUrl }, () => {
      const value = current.current
      return value.user && value.accessToken
        ? { userId: value.user.id, accessToken: value.accessToken }
        : null
    })
    void client
      .bootstrap()
      .then(() => {
        if (mounted) {
          client.start()
          setClient(client)
        }
      })
      .catch((e: unknown) => {
        if (mounted) setError(e instanceof Error ? e.message : 'Conexão indisponível.')
      })
    return () => {
      mounted = false
      client.stop()
      client.db.close()
    }
  }, [projectUrl, userId, workerUrl])
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
