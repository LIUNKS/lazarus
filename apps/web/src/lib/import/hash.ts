/**
 * Replaces every CR LF with LF. A run of CR characters before an LF counts as one line ending, so the result never
 * contains CR LF and the function is idempotent. A CR that is not followed by LF is left alone.
 */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r+\n/g, '\n');
}

/** Lowercase hexadecimal SHA-256 digest of the text encoded as UTF-8. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}