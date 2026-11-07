import { redirect } from 'next/navigation';
import { safeRedirectPath } from '@/lib/security/safe-redirect';
import { isUuid } from '@/lib/security/uuid';
import { createClient } from '@/lib/supabase/server';

export interface Member {
  id: string;
  email: string | null;
}

/** The part of a Supabase client that identity checks need. Tests pass a fake. */
export interface ClaimsClient {
  auth: {
    getClaims(): Promise<{ data: { claims: Record<string, unknown> } | null; error: unknown }>;
  };
}

/** Pure: maps verified claims to a Member, or null when the claims do not describe a user. */
export function memberFromClaims(claims: Record<string, unknown> | null | undefined): Member | null {
  if (!claims) return null;
  const id = claims['sub'];
  if (!isUuid(id)) return null;
  const email = claims['email'];
  return { id, email: typeof email === 'string' && email !== '' ? email : null };
}

/**
 * Returns the signed-in Member from verified claims, or null for a Visitor.
 * getClaims verifies the token signature; getSession would trust the cookie and is never used for this.
 */
export async function getCurrentMember(client?: ClaimsClient): Promise<Member | null> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;
  return memberFromClaims(data.claims);
}

/** Returns the Member or redirects a Visitor to the sign-in page, remembering where they wanted to go. */
export async function requireMember(nextPath: string, client?: ClaimsClient): Promise<Member> {
  const member = await getCurrentMember(client);
  if (member) return member;
  const next = safeRedirectPath(nextPath) ?? '/';
  redirect(`/sign-in?next=${encodeURIComponent(next)}`);
}