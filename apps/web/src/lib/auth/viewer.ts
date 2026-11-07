import { cache } from 'react';
import { getProfile, safeAvatarUrl } from '@/lib/data/profile';
import { readPublicConfig } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { getCurrentMember, type Member } from './member';

export interface Viewer {
  member: Member;
  displayName: string;
  avatarUrl: string | null;
}

/** Display data for the signed-in Member, or null for a Visitor. Never throws: the shell must render. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  try {
    if (!readPublicConfig().ok) return null;
    const supabase = await createClient();
    const member = await getCurrentMember(supabase);
    if (!member) return null;
    const profile = await getProfile(supabase, member.id);
    return {
      member,
      displayName: profile?.githubUsername ?? member.email ?? 'Member',
      avatarUrl: safeAvatarUrl(profile?.avatarUrl ?? null),
    };
  } catch {
    return null;
  }
});