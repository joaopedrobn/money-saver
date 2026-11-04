import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { authConfig, selectPersistenceBackend } from './config'
import { activePersistenceBackend, repositories } from '../repositories'
import {
  decodeRemoteBackup,
  fromRemoteRow,
  remoteFields,
  sqlTable,
  toRemoteRow,
  type RemoteEntity,
} from './mapping'
import { createSupabaseRepositories } from './repositories'

const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const instant = '2026-01-01T00:00:00.000Z'
const valid = {
  VITE_SUPABASE_AUTH_ENABLED: 'true',
  VITE_SUPABASE_URL: 'https://example.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only',
  VITE_SUPABASE_AUTH_REDIRECT_URL: 'http://127.0.0.1:5173/',
}

it('keeps the financial backend local regardless of configuration or remote login', () => {
  expect(activePersistenceBackend).toBe('local')
  expect(selectPersistenceBackend()).toBe('local')
  expect(() => selectPersistenceBackend('supabase')).toThrow('indisponível')
  expect(repositories.accounts.constructor.name).toBe('DexieAccountRepository')
})
it('disables remote auth with absent or explicitly disabled configuration', () => {
  expect(authConfig({}, 'http://127.0.0.1:5173/')).toEqual({ enabled: false, error: '' })
  expect(
    authConfig({ ...valid, VITE_SUPABASE_AUTH_ENABLED: 'false' }, 'http://127.0.0.1:5173/'),
  ).toEqual({ enabled: false, error: '' })
})
it('accepts only public publishable keys, safe endpoints and exact same-app callbacks', () => {
  expect(authConfig(valid, 'http://127.0.0.1:5173/#online').enabled).toBe(true)
  expect(authConfig(valid, 'http://localhost:5173/#online').enabled).toBe(false)
  expect(
    authConfig(
      { ...valid, VITE_SUPABASE_AUTH_REDIRECT_URL: 'http://localhost:5173/' },
      'http://localhost:5173/#online',
    ).enabled,
  ).toBe(true)
  for (const patch of [
    { VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_forbidden' },
    { VITE_SUPABASE_PUBLISHABLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.service_role' },
    { VITE_SUPABASE_URL: 'http://example.com' },
    { VITE_SUPABASE_URL: 'https://user:password@example.com' },
    { VITE_SUPABASE_AUTH_REDIRECT_URL: 'https://evil.example/' },
    { VITE_SUPABASE_AUTH_REDIRECT_URL: 'http://127.0.0.1:5173/other' },
    { VITE_SUPABASE_AUTH_REDIRECT_URL: 'http://127.0.0.1:5173/?next=https://evil.example' },
    { VITE_SUPABASE_URL: '' },
    { VITE_SUPABASE_AUTH_REDIRECT_URL: '' },
  ])
    expect(authConfig({ ...valid, ...patch }, 'http://127.0.0.1:5173/').enabled).toBe(false)
})
it('maps every allowlisted field of all 16 entities without changing UUIDs, cents or dates', () => {
  const dates = new Set([
    'date',
    'openingDate',
    'startDate',
    'endDate',
    'settledDate',
    'reversalDate',
    'closingDate',
    'dueDate',
  ])
  for (const entity of Object.keys(remoteFields) as RemoteEntity[]) {
    const value = Object.fromEntries(
      remoteFields[entity]
        .split(' ')
        .map((field) => [
          field,
          field === 'id' || field.endsWith('Id')
            ? id
            : field.endsWith('Cents')
              ? 12345
              : ['createdAt', 'updatedAt', 'reversedAt', 'at'].includes(field)
                ? instant
                : dates.has(field)
                  ? '2026-01-01'
                  : ['before', 'after'].includes(field)
                    ? { id, createdAt: instant, updatedAt: instant, amountCents: 123 }
                    : 'test',
        ]),
    )
    expect(fromRemoteRow(entity, toRemoteRow(entity, value, owner), owner)).toEqual(value)
    expect(sqlTable(entity)).toMatch(/^ms_[a-z_]+$/)
  }
  expect(Object.keys(remoteFields)).toHaveLength(16)
})
it('rejects foreign owners, unsafe cents, invalid UUIDs, unknown fields and incomplete snapshots', () => {
  const row = toRemoteRow('accounts', { id }, owner)
  expect(() => fromRemoteRow('accounts', row, other)).toThrow('outro usuário')
  expect(() => toRemoteRow('accounts', { id, user_id: other }, owner)).toThrow('não permitido')
  expect(() => toRemoteRow('accounts', { id: 'legacy-text-id' }, owner)).toThrow('UUID')
  expect(() =>
    toRemoteRow('accounts', { openingBalanceCents: Number.MAX_SAFE_INTEGER + 1 }, owner),
  ).toThrow('seguro')
  expect(() => fromRemoteRow('accounts', { ...row, opening_balance_cents: '100' }, owner)).toThrow(
    'inteiros',
  )
  expect(() => decodeRemoteBackup({}, owner)).toThrow('ausente')
  const empty = Object.fromEntries(Object.keys(remoteFields).map((key) => [key, []]))
  expect(decodeRemoteBackup(empty, owner).data.accounts).toEqual([])
  expect(() =>
    decodeRemoteBackup(
      {
        ...empty,
        payments: [
          {
            ...row,
            invoice_id: id,
            account_id: id,
            amount_cents: 100,
            date: '2026-01-02',
            created_at: instant,
            updated_at: instant,
          },
        ],
      },
      owner,
    ),
  ).toThrow('inconsistente')
})
it('prepares a compatible remote adapter that denies unauthenticated reads and every write before I/O', async () => {
  const rpc = vi.fn(),
    getUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null })
  const remote = createSupabaseRepositories({ rpc, auth: { getUser } } as unknown as SupabaseClient)
  await expect(remote.snapshot()).rejects.toThrow('Autenticação')
  await expect(remote.backup.restore({}, 'RESTAURAR')).rejects.toThrow('bloqueadas')
  await expect(remote.settings.setCreditRegime('purchase')).rejects.toThrow('bloqueadas')
  await expect(remote.planning.removeBudget(id)).rejects.toThrow('bloqueadas')
  expect(rpc).not.toHaveBeenCalled()
})
it('uses one snapshot RPC and discards results when the authenticated identity changes', async () => {
  const empty = Object.fromEntries(Object.keys(remoteFields).map((key) => [key, []]))
  const rpc = vi.fn().mockResolvedValue({ data: empty, error: null })
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: owner } }, error: null })
  const remote = createSupabaseRepositories({ rpc, auth: { getUser } } as unknown as SupabaseClient)
  expect((await remote.snapshot()).accounts).toEqual([])
  expect(rpc).toHaveBeenCalledExactlyOnceWith('ms_snapshot')
  getUser
    .mockResolvedValueOnce({ data: { user: { id: owner } }, error: null })
    .mockResolvedValueOnce({ data: { user: { id: other } }, error: null })
  await expect(remote.snapshot()).rejects.toThrow('sessão mudou')
})
