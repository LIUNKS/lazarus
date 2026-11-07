'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requestOrigin } from '@/lib/security/request-origin';
import { safeRedirectPath } from '@/lib/security/safe-redirect';
import { createClient } from '@/lib/supabase/server';

const FAILURE_PATH = '/?auth_error=callback';

/** Starts the GitHub OAuth flow (PKCE). The verifier cookie is written through the Server_Client. */
export async function signInWithGitHub(formData: FormData): Promise<void> {
  const next = safeRedirectPath(formData.get('next')) ?? '/';
  const origin = requestOrigin(await headers());
  if (origin === null) redirect(FAILURE_PATH);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) redirect(FAILURE_PATH);
  redirect(data.url);
}