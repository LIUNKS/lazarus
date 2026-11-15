import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getReincarnation, getSeanceSpec } from './stages';

/** The two stage reads of a corpse, issued concurrently once per request (Requirement 2 criterion 7). */
export const loadStages = cache(async (corpseId: string) => {
  const client = await createClient();
  const [seance, reincarnation] = await Promise.all([getSeanceSpec(client, corpseId), getReincarnation(client, corpseId)]);
  return { seance, reincarnation };
});
