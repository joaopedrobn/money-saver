import type { SupabaseClient } from '@supabase/supabase-js'
import { authConfig } from './config'

let client: Promise<SupabaseClient> | null = null
export const remoteAuthConfig = () => authConfig(import.meta.env, window.location.href)
export async function getAuthClient(): Promise<SupabaseClient | null> {
  const config = remoteAuthConfig()
  if (!config.enabled) return null
  client ??= import('@supabase/supabase-js')
    .then(({ createClient }) =>
      createClient(config.url, config.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: 'pkce',
          storageKey: 'money-saver-remote-auth',
        },
      }),
    )
    .catch((error: unknown) => {
      client = null
      throw error
    })
  return client
}
