import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { containsForbiddenPhrase } from '@/lib/pipeline/forbidden';
import { verifyBody, type VerifySource } from './present';

const NOT_RUN_WORDS = /\b(verified|tested|proven|proof|equivalent)\b/i;
const FAILED_WORDS = /\b(verified|proven|proof)\b/i;

const stringsOf = (value: unknown): string[] =>
  typeof value === 'string' ? [value] : typeof value === 'object' && value !== null ? Object.values(value).flatMap(stringsOf) : [];

const runs = fc.oneof(fc.constant(null), fc.constantFrom(0, 1, 99, 100, 999, 1_000, 1_001, 12_345_678), fc.integer({ min: 0, max: 5_000_000 }));
const row = fc.record({
  id: fc.uuid(),
  targetStack: fc.constant('TypeScript (strict, ES2022)'),
  pbtPassed: fc.constantFrom(true, false, null),
  totalRuns: runs,
  executionTimeMs: fc.oneof(fc.constant(null), fc.nat()),
});
const corpse = fc.record({ id: fc.uuid(), status: fc.constantFrom('INFECTED' as const, 'IN_SEANCE' as const, 'RESURRECTED' as const, 'FAILED' as const) });
const source = fc.constantFrom<VerifySource>('precomputed', 'stored', 'executed');

const withCommas = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

describe('verification response body', () => {
  it('R2.4 has the exact shape and wording of Requirements 2 and 10 for any stored row', () => {
    // Feature: 08-live-verification-api, Property 7: Response shape and wording
    fc.assert(
      fc.property(source, row, corpse, (src, stored, owner) => {
        const body = verifyBody(src, stored, owner);
        const expectedVerification = stored.pbtPassed === true ? 'VERIFIED' : stored.pbtPassed === false ? 'FAILED' : 'NOT_RUN';
        const expectedEvidence =
          stored.pbtPassed === true && stored.totalRuns !== null ? `Verified behavioral equivalence across ${withCommas(stored.totalRuns)} generated inputs.` : null;
        const strings = stringsOf(body);
        return (
          JSON.stringify(Object.keys(body).sort()) === '["corpse","ok","reincarnation","source"]' &&
          JSON.stringify(Object.keys(body.reincarnation).sort()) ===
            '["evidence","executionTimeMs","id","pbtPassed","targetStack","totalRuns","verification"]' &&
          JSON.stringify(Object.keys(body.corpse).sort()) === '["id","status"]' &&
          body.ok === true &&
          body.source === src &&
          body.reincarnation.pbtPassed === stored.pbtPassed &&
          body.reincarnation.totalRuns === stored.totalRuns &&
          body.reincarnation.executionTimeMs === stored.executionTimeMs &&
          body.reincarnation.verification === expectedVerification &&
          body.reincarnation.evidence === expectedEvidence &&
          (expectedVerification !== 'NOT_RUN' || !strings.some((text) => NOT_RUN_WORDS.test(text))) &&
          (expectedVerification !== 'FAILED' || !strings.some((text) => FAILED_WORDS.test(text))) &&
          !containsForbiddenPhrase(body)
        );
      }),
      { numRuns: 200 },
    );
  });

  it('R2.5 formats the evidence count with commas (Requirement 2)', () => {
    const body = verifyBody('executed', { id: 'r', targetStack: 't', pbtPassed: true, totalRuns: 1000, executionTimeMs: 5 }, { id: 'c', status: 'RESURRECTED' });
    expect(body.reincarnation.evidence).toBe('Verified behavioral equivalence across 1,000 generated inputs.');
  });
});
