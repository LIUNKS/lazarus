import { NextResponse, type NextRequest } from 'next/server';
import { readPublicConfig } from '@/lib/env';
import { updateSession } from '@/lib/supabase/proxy';

const CONFIGURATION_ERROR_PATH = '/configuration-error';

export async function proxy(request: NextRequest) {
  const result = readPublicConfig();

  // Without a valid public configuration nothing can work: answer 503 with the explanation page.
  if (!result.ok) {
    if (request.nextUrl.pathname === CONFIGURATION_ERROR_PATH) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = CONFIGURATION_ERROR_PATH;
    url.search = '';
    return NextResponse.rewrite(url, { status: 503 });
  }

  return updateSession(request, result.config);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|otf)$).*)'],
};