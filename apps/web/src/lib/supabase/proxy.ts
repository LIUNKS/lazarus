import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { PublicConfig } from '@/lib/env';

/**
 * Refreshes the Supabase session for one request.
 * The response that setAll built last must be returned: an earlier one lacks the refreshed cookies.
 * A Supabase failure never blocks the page.
 */
export async function updateSession(request: NextRequest, config: PublicConfig): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  try {
    const supabase = createServerClient(config.supabaseUrl, config.supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, cacheHeaders) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
          // Cache headers keep a CDN from serving one user's session cookie to another user.
          for (const [header, value] of Object.entries(cacheHeaders)) response.headers.set(header, value);
        },
      },
    });
    // getClaims verifies the token signature and refreshes the session when it is close to expiring.
    await supabase.auth.getClaims();
  } catch {
    // Supabase is unreachable or misbehaving: let the request continue with whatever cookies it has.
  }

  return response;
}