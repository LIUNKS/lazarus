import type { SupabaseClient } from '@supabase/supabase-js';
import { fail } from './corpses';
import { parseReincarnation, parseSeanceSpec, type Reincarnation, type SeanceSpec } from './types';

// The stage reads and the approval run with the Server_Client of the request, so RLS decides which rows exist for the caller.
const SEANCE_COLUMNS = 'id,requirements_md,design_md,invariants_json,approved_at';
const REINCARNATION_COLUMNS = 'id,target_stack,modern_code,pbt_test_code,pbt_passed,total_runs,execution_time_ms,created_at';

/**
 * The stored séance of a corpse, or null when none is visible. `limit(1)` keeps the read working when more than one row
 * exists (`seance_specs` has no created_at to order by), and the first row is used.
 */
export async function getSeanceSpec(client: SupabaseClient, corpseId: string): Promise<SeanceSpec | null> {
  const { data, error } = await client
    .from('seance_specs')
    .select(SEANCE_COLUMNS)
    .eq('corpse_id', corpseId)
    .limit(1)
    .maybeSingle();
  if (error) throw fail('Reading a seance spec', error);
  return data ? parseSeanceSpec(data) : null;
}

/** The most recent reincarnation of a corpse, or null when none is visible. */
export async function getReincarnation(client: SupabaseClient, corpseId: string): Promise<Reincarnation | null> {
  const { data, error } = await client
    .from('reincarnations')
    .select(REINCARNATION_COLUMNS)
    .eq('corpse_id', corpseId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw fail('Reading a reincarnation', error);
  return data ? parseReincarnation(data) : null;
}

/**
 * Sets `approved_at` on the séance of the corpse when it is still NULL, and writes no other column. RLS limits the update to
 * the owner. Returns false when no row changed (not owned, a sample, no spec, or already approved).
 */
export async function approveSeanceSpec(client: SupabaseClient, corpseId: string, nowIso: string): Promise<boolean> {
  const { data, error } = await client
    .from('seance_specs')
    .update({ approved_at: nowIso })
    .eq('corpse_id', corpseId)
    .is('approved_at', null)
    .select('id');
  if (error) throw fail('Approving a seance spec', error);
  return (data ?? []).length > 0;
}
