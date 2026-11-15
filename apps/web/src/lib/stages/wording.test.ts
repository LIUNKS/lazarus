import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { containsForbiddenTerm, FORBIDDEN_TERMS } from './wording';

describe('R6.9 R14.5 Forbidden_Terms', () => {
  it('lists the claim phrases of the Pipeline_API and the word that the UI rules rule out', () => {
    expect([...FORBIDDEN_TERMS].sort()).toEqual(['100%', 'guaranteed', 'mathematical proof', 'mathematically proven', 'proof']);
  });

  it.each(FORBIDDEN_TERMS)('detects "%s" in any letter case, inside a longer sentence', (term) => {
    expect(containsForbiddenTerm(`Some text ${term} more text`)).toBe(true);
    expect(containsForbiddenTerm(term.toUpperCase())).toBe(true);
  });

  it.each([
    'Verified behavioral equivalence across 1,000 generated inputs.',
    'This is empirical evidence from randomly generated inputs. Other inputs were not checked.',
    'Not verified yet.',
    '',
  ])('does not flag the evidence wording "%s"', (text) => {
    expect(containsForbiddenTerm(text)).toBe(false);
  });

  it('R14.5 flags every text that contains a Forbidden_Term and no text that avoids them', () => {
    // Feature: 06-resurrection-ui, Supporting check: forbidden term detection
    const term = fc.constantFrom(...FORBIDDEN_TERMS);
    const filler = fc.string({ maxLength: 20 });
    fc.assert(
      fc.property(filler, term, filler, (before, forbidden, after) => containsForbiddenTerm(`${before}${forbidden}${after}`)),
      { numRuns: 200 },
    );
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (text) => {
        const lower = text.toLowerCase();
        return containsForbiddenTerm(text) === FORBIDDEN_TERMS.some((forbidden) => lower.includes(forbidden));
      }),
      { numRuns: 200 },
    );
  });
});
