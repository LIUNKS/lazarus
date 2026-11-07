// A Safe_Redirect_Path is a same-origin path: it starts with a single "/", contains no backslash
// and no control character, and is at most 512 characters long.
export const MAX_REDIRECT_LENGTH = 512;

export function safeRedirectPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > MAX_REDIRECT_LENGTH) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('\\')) return null;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return null;
  }
  return value;
}