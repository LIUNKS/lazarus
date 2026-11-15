'use server';

import { redirect } from 'next/navigation';
import { requireMember } from '@/lib/auth/member';
import { deleteCorpseById } from '@/lib/data/corpses';
import { approveSeanceSpec } from '@/lib/data/stages';
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

/**
 * Approves the stored séance of one of the Member's own corpses. It sets `approved_at` where it is still NULL and writes no
 * other column. It calls no model and no Pipeline_API route. RLS limits the update to the owner, so a sample, a corpse of
 * another Member, a missing spec, and an already approved spec all update zero rows and give the same generic notice.
 * The redirect target is built only from a validated UUID and fixed notice codes.
 */
export async function approveSeance(formData: FormData): Promise<void> {
  const id = formData.get('id');
  // A Visitor is sent to sign-in here, and nothing is written.
  await requireMember(isUuid(id) ? `/corpses/${id}` : '/crypt');
  if (!isUuid(id)) redirect('/crypt?notice=approve-failed');

  let approved = false;
  try {
    approved = await approveSeanceSpec(await createClient(), id, new Date().toISOString());
  } catch {
    approved = false; // already logged by the data layer; the notice stays generic
  }
  redirect(`/corpses/${id}?notice=${approved ? 'approved' : 'approve-failed'}#seance-chamber`);
}