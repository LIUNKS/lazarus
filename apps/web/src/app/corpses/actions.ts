'use server';

import { redirect } from 'next/navigation';
import { requireMember } from '@/lib/auth/member';
import { deleteCorpseById } from '@/lib/data/corpses';
import { isUuid } from '@/lib/security/uuid';
import { createClient } from '@/lib/supabase/server';

/**
 * Deletes one of the Member's own corpses. RLS limits the effect to rows the Member owns, and the
 * database cascade removes curses, specs, and reincarnations, so no child rows are deleted here.
 */
export async function deleteCorpse(formData: FormData): Promise<void> {
  await requireMember('/crypt');
  const id = formData.get('id');
  if (!isUuid(id)) redirect('/crypt?notice=delete-failed');

  let deleted = false;
  try {
    deleted = await deleteCorpseById(await createClient(), id);
  } catch {
    deleted = false; // already logged by the data layer; the message stays generic
  }
  redirect(deleted ? '/crypt?notice=deleted' : '/crypt?notice=delete-failed');
}