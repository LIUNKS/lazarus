import { createBrowserClient } from '@supabase/ssr';
import { readPublicConfig } from '@/lib/env';

/** Browser_Client for Client Components. createBrowserClient keeps a single instance. */
export function createClient() {
  const result = readPublicConfig();
  if (!result.ok) throw new Error('Supabase configuration is invalid.');
  return createBrowserClient(result.config.supabaseUrl, result.config.supabaseAnonKey);
}