import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { readPublicConfig } from '@/lib/env';

export class ConfigurationError extends Error {
  constructor() {
    super('Supabase configuration is invalid.');
    this.name = 'ConfigurationError';
  }
}

/** Server_Client: create one per request. It runs under the role of the request (anon or authenticated). */
export async function createClient() {
  const result = readPublicConfig();
  if (!result.ok) throw new ConfigurationError();
  const cookieStore = await cookies();

  return createServerClient(result.config.supabaseUrl, result.config.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot write cookies. The Proxy refreshes the session and writes them.
        }
      },
    },
  });
}

export type ServerClient = Awaited<ReturnType<typeof createClient>>;