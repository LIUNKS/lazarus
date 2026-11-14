// Detector for the Forbidden_Phrases (Requirements 10, 13, and 19). Pure module.
// Lazarus describes results as empirical evidence, so these claims must never appear in authored or generated text.

export const FORBIDDEN_PHRASES = ['100%', 'mathematical proof', 'mathematically proven', 'guaranteed'] as const;

function stringHasForbiddenPhrase(text: string): boolean {
  const lower = text.toLowerCase();
  return FORBIDDEN_PHRASES.some((phrase) => lower.includes(phrase));
}

/**
 * True when any string in the value contains a Forbidden_Phrase (case-insensitive substring).
 * Walks strings, arrays, and plain objects. It checks string values, not object keys. Never throws:
 * cycles are cut with a visited set, and every other value type counts as "no phrase".
 */
export function containsForbiddenPhrase(value: unknown): boolean {
  const seen = new WeakSet<object>();
  const visit = (node: unknown): boolean => {
    if (typeof node === 'string') return stringHasForbiddenPhrase(node);
    if (typeof node !== 'object' || node === null) return false;
    if (seen.has(node)) return false;
    seen.add(node);
    try {
      if (Array.isArray(node)) return node.some(visit);
      const prototype: unknown = Object.getPrototypeOf(node);
      if (prototype !== Object.prototype && prototype !== null) return false;
      return Object.values(node).some(visit);
    } catch {
      return false;
    }
  };
  return visit(value);
}
