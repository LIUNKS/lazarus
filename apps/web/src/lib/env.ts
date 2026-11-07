// Validation of the public Supabase configuration.
// Errors name the variable and the reason. They never contain a variable value.

export type ConfigVariable = 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY';

export interface ConfigProblem {
  variable: ConfigVariable;
  reason: 'missing' | 'invalid';
}

export interface PublicConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export type ConfigResult = { ok: true; config: PublicConfig } | { ok: false; problems: ConfigProblem[] };

function isAllowedUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return url.hostname !== '';
  if (url.protocol === 'http:') return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  return false;
}

/** Pure validation. Blank values count as missing. */
export function validatePublicConfig(input: {
  url: string | undefined;
  anonKey: string | undefined;
}): ConfigResult {
  const problems: ConfigProblem[] = [];
  const url = input.url?.trim() ?? '';
  const anonKey = input.anonKey?.trim() ?? '';

  if (url === '') problems.push({ variable: 'NEXT_PUBLIC_SUPABASE_URL', reason: 'missing' });
  else if (!isAllowedUrl(url)) problems.push({ variable: 'NEXT_PUBLIC_SUPABASE_URL', reason: 'invalid' });

  if (anonKey === '') problems.push({ variable: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', reason: 'missing' });

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, config: { supabaseUrl: url, supabaseAnonKey: anonKey } };
}

/**
 * Reads the two variables. Next.js inlines NEXT_PUBLIC_* values into client bundles only for
 * literal `process.env.NAME` expressions, so the property names must stay literal here.
 */
export function readPublicConfig(): ConfigResult {
  return validatePublicConfig({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}