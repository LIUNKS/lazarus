import type { SupabaseClient } from '@supabase/supabase-js';
import { DataError, parseDetail, parseSummary, type CorpseDetail, type CorpseSummary, type SourceLanguage } from './types';

// One request per list: the embedded count avoids one query per corpse.
const SUMMARY_COLUMNS = 'id,title,source_language,status,created_at,is_sample,curses(count)';
const DETAIL_COLUMNS =
  'id,title,source_language,status,created_at,is_sample,user_id,repo_url,original_code,curses(id,curse_type,severity,line_number)';

export const OWNED_LIST_LIMIT = 50;

interface DatabaseError {
  code?: string;
  message?: string;
}

/** Logs on the server and returns a DataError whose message is generic. */
function fail(context: string, error: DatabaseError): DataError {
  console.error(`[data] ${context} failed: ${error.code ?? 'no-code'} ${error.message ?? ''}`.trim());
  return new DataError(`${context} failed.`);
}

export async function listSampleCorpses(client: SupabaseClient): Promise<CorpseSummary[]> {
  const { data, error } = await client
    .from('corpses')
    .select(SUMMARY_COLUMNS)
    .eq('is_sample', true)
    .order('title', { ascending: true });
  if (error) throw fail('Listing sample corpses', error);
  return (data ?? []).map(parseSummary);
}

export async function listOwnedCorpses(
  client: SupabaseClient,
  memberId: string,
  { page, pageSize }: { page: number; pageSize: number },
): Promise<{ items: CorpseSummary[]; total: number }> {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await client
    .from('corpses')
    .select(SUMMARY_COLUMNS, { count: 'exact' })
    .eq('user_id', memberId)
    .eq('is_sample', false)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw fail('Listing owned corpses', error);
  return { items: (data ?? []).map(parseSummary), total: count ?? 0 };
}

/** Returns null when the corpse does not exist or is not visible to the current role. */
export async function getCorpse(client: SupabaseClient, id: string): Promise<CorpseDetail | null> {
  const { data, error } = await client
    .from('corpses')
    .select(DETAIL_COLUMNS)
    .eq('id', id)
    .order('line_number', { referencedTable: 'curses', ascending: true })
    .maybeSingle();
  if (error) throw fail('Reading a corpse', error);
  return data ? parseDetail(data) : null;
}

export async function countOwnedCorpses(client: SupabaseClient, memberId: string): Promise<number> {
  const { count, error } = await client
    .from('corpses')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', memberId)
    .eq('is_sample', false);
  if (error) throw fail('Counting owned corpses', error);
  return count ?? 0;
}

export async function findOwnedCorpseIdByHash(
  client: SupabaseClient,
  memberId: string,
  codeHash: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('corpses')
    .select('id')
    .eq('user_id', memberId)
    .eq('code_hash', codeHash)
    .limit(1)
    .maybeSingle();
  if (error) throw fail('Looking up an imported corpse', error);
  const id = (data as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : null;
}

export interface NewCorpse {
  memberId: string;
  title: string;
  sourceLanguage: SourceLanguage;
  originalCode: string;
  codeHash: string;
  repoUrl: string | null;
}

/** Inserts an owned corpse with the caller's own session. RLS requires is_sample = false and user_id = the caller. */
export async function insertCorpse(client: SupabaseClient, corpse: NewCorpse): Promise<string> {
  const { data, error } = await client
    .from('corpses')
    .insert({
      user_id: corpse.memberId,
      is_sample: false,
      status: 'INFECTED',
      title: corpse.title,
      source_language: corpse.sourceLanguage,
      original_code: corpse.originalCode,
      code_hash: corpse.codeHash,
      repo_url: corpse.repoUrl,
    })
    .select('id')
    .single();
  if (error) throw fail('Saving a corpse', error);
  const id = (data as { id?: unknown } | null)?.id;
  if (typeof id !== 'string') throw new DataError('Saving a corpse returned no id.');
  return id;
}

/** Deletes by id under RLS. Returns false when no row was deleted (not owned, a sample, or already gone). */
export async function deleteCorpseById(client: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await client.from('corpses').delete().eq('id', id).select('id');
  if (error) throw fail('Deleting a corpse', error);
  return (data ?? []).length > 0;
}