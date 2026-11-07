import { NextResponse, type NextRequest } from 'next/server';
import { requestOrigin } from '@/lib/security/request-origin';
import { safeRedirectPath } from '@/lib/security/safe-redirect';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const origin = requestOrigin(request.headers);
  if (origin === null) return new NextResponse('Bad request', { status: 400 });

  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeRedirectPath(searchParams.get('next')) ?? '/';

  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(`${origin}${next}`);
    } catch {
      // Fall through to the generic failure redirect. Nothing from the error is shown to the user.
    }
  }
  // The raw error and error_description parameters are never echoed; a fixed code selects a fixed message.
  return NextResponse.redirect(`${origin}/?auth_error=callback`);
}