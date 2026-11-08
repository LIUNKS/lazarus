// A chainable fake of the Supabase query builder for unit tests. It records every call and
// resolves to the next prepared result when a query is awaited. Test-only: no production module imports this file.
import type { SupabaseClient } from '@supabase/supabase-js';

export type FakeResult = { data?: unknown; error?: { code?: string; message?: string } | null; count?: number | null };
export type FakeCall = [method: string, args: unknown[]];
type Claims = { data: { claims: Record<string, unknown> } | null; error: unknown };

/** `result` may be one value for every query or a list consumed one query at a time (the last one repeats). */
export function fakeClient(result: FakeResult | FakeResult[], claims?: Claims) {
  const calls: FakeCall[] = [];
  const queue = Array.isArray(result) ? [...result] : null;
  const next = (): FakeResult => {
    const value = queue ? (queue.length > 1 ? queue.shift() : queue[0]) : (result as FakeResult);
    return { data: null, error: null, count: null, ...value };
  };
  const builder: unknown = new Proxy(
    {},
    {
      get(_target, property: string) {
        if (property === 'then') return (resolve: (value: FakeResult) => unknown) => resolve(next());
        return (...args: unknown[]) => {
          calls.push([property, args]);
          return builder;
        };
      },
    },
  );
  const client = {
    from: (table: string) => {
      calls.push(['from', [table]]);
      return builder;
    },
    // Records the call and returns the same thenable builder, so `.abortSignal(...)` chains and `await` resolves the next result.
    rpc: (name: string, args?: unknown) => {
      calls.push(['rpc', [name, args]]);
      return builder;
    },
    auth: {
      getClaims: async () => claims ?? { data: null, error: null },
      signOut: async () => {
        calls.push(['signOut', []]);
        return { error: null };
      },
      signInWithOAuth: async (...args: unknown[]) => {
        calls.push(['signInWithOAuth', args]);
        return { data: { url: 'https://example.test/authorize' }, error: null };
      },
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

// An RPC may write (reserve_llm_call and replace_corpse_curses do), so it counts as a write call.
export const WRITE_METHODS = ['insert', 'update', 'delete', 'upsert', 'rpc', 'signOut', 'signInWithOAuth'] as const;

export function writeCalls(calls: FakeCall[]): FakeCall[] {
  return calls.filter(([method]) => (WRITE_METHODS as readonly string[]).includes(method));
}