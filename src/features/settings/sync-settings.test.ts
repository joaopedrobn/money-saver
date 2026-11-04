import { it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SyncSettings } from './SyncSettings'
import { SyncStatus } from './SyncStatus'
import { disabledSyncState } from '@/infrastructure/sync/state'

it('keeps the normal application closed and exposes no financial send/import control', () => {
  const html = renderToStaticMarkup(createElement(SyncSettings))
  expect(html).toContain('Sincronização desativada')
  expect(html).not.toContain('<button')
})
it('never labels a pending or unverified operation as synchronized', () => {
  for (const state of [
    {
      ...disabledSyncState,
      enabled: true,
      phase: 'verified' as const,
      pending: 1,
      lastCompletedAt: '2026-11-04T12:00:00Z',
    },
    { ...disabledSyncState, enabled: true, phase: 'verified' as const, pending: 0 },
  ]) {
    const html = renderToStaticMarkup(createElement(SyncStatus, { state }))
    expect(html).toContain('Pendente')
    expect(html).not.toContain('Sincronizada')
  }
})
