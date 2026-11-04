import {
  SyncClient,
  SyncLabDatabase,
  localWorkerTransport,
  type SessionIdentity,
  type SyncTransport,
} from './outbox'
import { requireUuid } from './protocol'
import type { CivilDate } from '@/domain/models'

export interface LocalTestMode {
  enabled: boolean
  development: boolean
  appOrigin: string
  projectUrl: string
  workerUrl: string
  userId: string
  runId: string
  deviceId: string
  asOf: CivilDate
}
export function assertLocalTestMode(mode: LocalTestMode) {
  requireUuid(mode.userId)
  if (
    !mode.enabled ||
    !mode.development ||
    mode.projectUrl !== 'http://127.0.0.1:54321' ||
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(mode.appOrigin) ||
    !/^http:\/\/127\.0\.0\.1:\d+(?:\/sync-api)?$/.test(mode.workerUrl) ||
    !/^[a-zA-Z0-9-]{1,100}$/.test(mode.runId) ||
    !/^[a-zA-Z0-9-]{1,60}$/.test(mode.deviceId)
  )
    throw new Error('Sincronização permitida somente em homologação local explicitamente ativada.')
}
/** One workspace used by the main application's repository context and integration tests.
 * Never opens, copies or upgrades the user's existing v4 IndexedDB. */
export function createApplicationSyncWorkspace(
  mode: LocalTestMode,
  session: () => SessionIdentity | null,
  transport?: SyncTransport,
) {
  assertLocalTestMode(mode)
  if (session()?.userId !== mode.userId)
    throw new Error('Sessão não corresponde ao usuário do espaço de teste.')
  const db = new SyncLabDatabase(
    `money-saver-sync-lab:${mode.userId}:app-${mode.runId}:${mode.deviceId}`,
  )
  const client = new SyncClient(
    db,
    mode.userId,
    transport ?? localWorkerTransport(mode.workerUrl),
    session,
    mode.asOf,
  )
  let initialized = false
  return {
    mode,
    client,
    repositories: client.repositories,
    async initialize() {
      await client.bootstrap()
      initialized = true
    },
    start() {
      if (!initialized) throw new Error('Verifique o backend local antes de ativar o envio.')
      client.start()
    },
    stop() {
      client.stop()
    },
    close() {
      client.stop()
      db.close()
    },
  }
}
export type ApplicationSyncWorkspace = ReturnType<typeof createApplicationSyncWorkspace>
