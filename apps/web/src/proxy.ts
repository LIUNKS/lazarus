import { NextResponse, type NextRequest } from 'next/server';
import { readPublicConfig } from '@/lib/env';
import { methodNotAllowedResponse } from '@/lib/pipeline/errors';
import { updateSession } from '@/lib/supabase/proxy';

const CONFIGURATION_ERROR_PATH = '/configuration-error';

// Next.js answers a missing method with an empty 405 and cannot send the Error_Envelope, so the Proxy does it.
const PIPELINE_PATHS = new Set(['/api/scan', '/api/seance', '/api/reincarnate']);

export async function proxy(request: NextRequest) {
  // Before the configuration check, so the answer is the same when the public configuration is invalid.
  if (PIPELINE_PATHS.has(request.nextUrl.pathname) && request.method !== 'POST') return methodNotAllowedResponse();

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