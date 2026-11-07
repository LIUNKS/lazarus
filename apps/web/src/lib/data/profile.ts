import type { SupabaseClient } from '@supabase/supabase-js';

export interface Profile {
  githubUsername: string | null;
  avatarUrl: string | null;
}

/** Reads the caller's own profile row. RLS lets a Member read only their own. */
export async function getProfile(client: SupabaseClient, memberId: string): Promise<Profile | null> {
  const { data, error } = await client
    .from('profiles')
    .select('github_username,avatar_url')
    .eq('id', memberId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { github_username?: unknown; avatar_url?: unknown };
  return {
    githubUsername: typeof row.github_username === 'string' && row.github_username !== '' ? row.github_username : null,
    avatarUrl: typeof row.avatar_url === 'string' && row.avatar_url !== '' ? row.avatar_url : null,
  };
}

/** Only https URLs are rendered as avatars. */
export function safeAvatarUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}