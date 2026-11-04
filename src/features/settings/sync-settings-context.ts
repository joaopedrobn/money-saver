import { createContext } from 'react'
import type { SyncClient } from '@/infrastructure/sync/outbox'

/** No application Auth event creates this context. Only the isolated local lab injects it. */
export const SyncSettingsContext = createContext<SyncClient | null>(null)
