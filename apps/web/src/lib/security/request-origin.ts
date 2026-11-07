// Builds the public origin of the current request from proxy headers.
// Supabase also checks redirect URLs against the project's allowlist, which bounds the risk of a forged Host header.
const HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;

function firstValue(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim();
  return first === undefined || first === '' ? null : first;
}

function isLocalHost(host: string): boolean {
  const name = host.split(':')[0];
  return name === 'localhost' || name === '127.0.0.1';
}

/** Returns "proto://host", or null when the headers do not describe a valid host. */
export function requestOrigin(headers: Pick<Headers, 'get'>): string | null {
  const host = firstValue(headers.get('x-forwarded-host')) ?? firstValue(headers.get('host'));
  if (host === null || !HOST_PATTERN.test(host)) return null;
  const forwarded = firstValue(headers.get('x-forwarded-proto'));
  const protocol = forwarded === 'http' || forwarded === 'https' ? forwarded : isLocalHost(host) ? 'http' : 'https';
  return `${protocol}://${host}`;
}