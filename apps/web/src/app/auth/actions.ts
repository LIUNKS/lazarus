'use server';

import { redirect } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth/member';
import { createClient } from '@/lib/supabase/server';

/** Signs the Member out. Only a POST Server Action can do this; a GET request never signs anyone out. */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  const member = await getCurrentMember(supabase);
  if (member) await supabase.auth.signOut();
  redirect('/');
}