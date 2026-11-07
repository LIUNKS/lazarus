import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getCorpse } from './corpses';

/** One corpse read per request, shared by the segment layout and the page. */
export const loadCorpse = cache(async (id: string) => getCorpse(await createClient(), id));