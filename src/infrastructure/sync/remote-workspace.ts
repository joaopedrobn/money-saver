import {
  SyncClient,
  SyncLabDatabase,
  workerTransport,
  type SessionIdentity,
  type SyncTransport,
} from './outbox'
import { requireUuid } from './protocol'
import { today } from '@/domain/financial-validation'

export const remoteProject = 'https://iwzmsbkbuerleocismhj.supabase.co'
export const remoteApi = 'https://money-saver.quem-votar-jp.workers.dev/sync-api'
export function remoteSyncConfig(env: Record<string, unknown>, appOrigin: string, userId: string) {
  requireUuid(userId)
  const enabled =
    env.VITE_REMOTE_SYNC_ENABLED === 'true' &&
    env.VITE_SUPABASE_URL === remoteProject &&
    String(env.VITE_SYNC_ALLOWED_USER_IDS ?? '')
      .split(',')
      .includes(userId)
  if (!enabled) return null
  const worker = new URL(String(env.VITE_SYNC_API_URL || '/sync-api'), appOrigin)
  const app = new URL(appOrigin)
  const local = app.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(app.hostname)
  if (
    (app.protocol !== 'https:' && !local) ||
    worker.protocol !== 'https:' ||
    worker.href !== remoteApi ||
    worker.search ||
    worker.hash ||
    worker.username ||
    worker.password
  )
    throw new Error('Endereço HTTPS da API de sincronização inválido.')
  return { projectUrl: remoteProject, workerUrl: worker.href, userId }
}
export function createRemoteSyncWorkspace(
  config: NonNullable<ReturnType<typeof remoteSyncConfig>>,
  session: () => SessionIdentity | null,
  transport?: SyncTransport,
) {
  requireUuid(config.userId)
  if (
    config.projectUrl !== remoteProject ||
    config.workerUrl !== remoteApi ||
    session()?.userId !== config.userId
  )
    throw new Error('Projeto ou sessão incompatível.')
  const db = new SyncLabDatabase(
    `money-saver-sync-remote:${encodeURIComponent(config.projectUrl)}:${config.userId}`,
  )
  return new SyncClient(
    db,
    config.userId,
    transport ?? workerTransport(config.workerUrl),
    session,
    today(),
    undefined,
    config.projectUrl,
  )
}
