// The claim phrases that no text of the stage screens may contain. Pure module: no framework imports, no process.env.
// Lazarus describes a verification result as empirical evidence with the exact run count, never as a stronger claim.
// The terms are the Forbidden_Phrases of the Pipeline_API plus the word that `ui-components.md` rules out.
export const FORBIDDEN_TERMS = ['100%', 'mathematical proof', 'mathematically proven', 'guaranteed', 'proof'] as const;

/** True when the text contains a Forbidden_Term, compared case-insensitively. */
export function containsForbiddenTerm(text: string): boolean {
  const lower = text.toLowerCase();
  return FORBIDDEN_TERMS.some((term) => lower.includes(term));
}
