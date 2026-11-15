import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  candidate,
  cyrillic,
  earsLines,
  forbiddenPhraseBreakers,
  latinLetterCount,
  lengthen,
  SEANCE_RULE_ORDER,
  seanceBreakerArb,
  validSeanceCase,
  withInvariants,
  withOutput,
  type SeanceCase,
} from '@/lib/testing/arbitraries';
import { FORBIDDEN_PHRASES } from './forbidden';
import { countEarsCriteria, validateSeanceOutput, type SeanceRule } from './seance-validate';

describe('R10 Seance output validation (Requirement 10)', () => {
  it('R10.1 R10.2 R10.3 R10.4 R10.5 accepts every output built to satisfy rules 1 to 5 (Requirement 10)', () => {
    // Feature: 05-llm-pipeline-api, Property 12: Séance output validation
    fc.assert(
      fc.property(validSeanceCase, ({ output, candidates }) => {
        expect(validateSeanceOutput(output, candidates)).toEqual({ ok: true });
        const criteria = countEarsCriteria(output.requirementsMd);
        expect(criteria).toBeGreaterThanOrEqual(3);
        expect(criteria).toBeLessThanOrEqual(10);
      }),
      { numRuns: 200 },
    );
  });

  it('R10.1 R10.2 R10.3 R10.4 rejects an output with exactly one rule broken, naming exactly that rule (Requirement 10 and 20)', () => {
    // Feature: 05-llm-pipeline-api, Property 12: Séance output validation
    fc.assert(
      fc.property(validSeanceCase, fc.oneof(seanceBreakerArb, forbiddenPhraseBreakers), (base, breaker) => {
        const broken = breaker.apply(base);
        expect(validateSeanceOutput(broken.output, broken.candidates)).toEqual({ ok: false, failedRules: [breaker.rule] });
      }),
      { numRuns: 300 },
    );
  });

  it('R10.5 rejects the Forbidden_Phrase check in every string of the output, as in the rejection of Forbidden_Phrases (Requirement 10)', () => {
    // Feature: 05-llm-pipeline-api, Property 12: Séance output validation
    const places: Array<(c: SeanceCase, text: string) => SeanceCase> = [
      (c, text) => withOutput(c, { requirementsMd: `${c.output.requirementsMd}\n${text}` }),
      (c, text) => withOutput(c, { designMd: `${c.output.designMd} ${text}` }),
      (c, text) => withInvariants(c, { input: `${String(c.output.invariants['input'])} ${text}` }),
      (c, text) => withInvariants(c, { output: `${String(c.output.invariants['output'])} ${text}` }),
      (c, text) => withInvariants(c, { invariants: [`${String((c.output.invariants['invariants'] as string[])[0])} ${text}`, ...(c.output.invariants['invariants'] as string[]).slice(1)] }),
    ];
    fc.assert(
      fc.property(validSeanceCase, fc.constantFrom(...FORBIDDEN_PHRASES), fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }), fc.integer({ min: 0, max: places.length - 1 }), (base, phrase, mask, index) => {
        const text = [...phrase].map((char, i) => (mask[i % mask.length] ? char.toUpperCase() : char)).join('');
        const broken = places[index]!(base, text);
        expect(validateSeanceOutput(broken.output, broken.candidates)).toEqual({ ok: false, failedRules: ['FORBIDDEN_PHRASE'] });
      }),
      { numRuns: 200 },
    );
  });

  it('R10.6 lists every failed rule, in the fixed order, when several rules are broken (Requirement 10)', () => {
    // Feature: 05-llm-pipeline-api, Property 12: Séance output validation
    fc.assert(
      fc.property(validSeanceCase, seanceBreakerArb, seanceBreakerArb, forbiddenPhraseBreakers, fc.boolean(), (base, first, second, forbidden, includeForbidden) => {
        fc.pre(first.rule !== second.rule);
        const chosen = includeForbidden ? [first, second, forbidden] : [first, second];
        const broken = chosen.reduce((state, breaker) => breaker.apply(state), base);
        const expected = SEANCE_RULE_ORDER.filter((rule) => chosen.some((breaker) => breaker.rule === rule));
        expect(validateSeanceOutput(broken.output, broken.candidates)).toEqual({ ok: false, failedRules: expected });
      }),
      { numRuns: 300 },
    );
  });

  it('R10.1 R10.2 enforces the length bounds exactly: 200 to 5,000 for requirements and 100 to 3,000 for design (Requirement 10)', () => {
    // Feature: 05-llm-pipeline-api, Property 12: Séance output validation
    const entry = 'calc_1';
    const candidates = [candidate(entry)];
    const requirementsOfLength = (length: number) => {
      const core = earsLines(3, ['value', 'value', 'value']).join('\n');
      return `${core}\n${'a'.repeat(length - core.length - 1)}`;
    };
    const designOfLength = (length: number) => `${entry} `.padEnd(length, 'b');
    fc.assert(
      fc.property(validSeanceCase, fc.constantFrom(199, 200, 201, 4_999, 5_000, 5_001), fc.constantFrom(99, 100, 101, 2_999, 3_000, 3_001), (base, requirementsLength, designLength) => {
        const state: SeanceCase = {
          candidates,
          output: {
            ...base.output,
            requirementsMd: requirementsOfLength(requirementsLength),
            designMd: designOfLength(designLength),
            invariants: { ...base.output.invariants, entry_function: entry },
          },
        };
        const expected: SeanceRule[] = [];
        if (requirementsLength < 200 || requirementsLength > 5_000) expected.push('REQUIREMENTS_FORMAT');
        if (designLength < 100 || designLength > 3_000) expected.push('DESIGN_FORMAT');
        const verdict = validateSeanceOutput(state.output, state.candidates);
        expect(verdict).toEqual(expected.length === 0 ? { ok: true } : { ok: false, failedRules: expected });
      }),
      { numRuns: 100 },
    );
  });

  it('R10.1 enforces the 95% Basic Latin letter share at its boundary (Requirement 10)', () => {
    // Feature: 05-llm-pipeline-api, Property 12: Séance output validation
    const entry = 'calc_1';
    const base = earsLines(3, ['value', 'value', 'value']).join('\n');
    const rest = lengthen(base, 200);
    const baseLatin = latinLetterCount(rest);
    // With n non-Latin letters added, the share is baseLatin / (baseLatin + n).
    const maxAllowed = Math.floor(baseLatin * (1 / 0.95 - 1));
    expect(latinLetterCount(base)).toBeGreaterThan(0);
    const output = (extra: number) => ({
      requirementsMd: `${rest}\n${cyrillic(extra)}`,
      designMd: `${entry} ${'b'.repeat(120)}`,
      invariants: { entry_function: entry, input: 'x', output: 'y', invariants: ['a', 'b', 'c'] },
    });
    expect(validateSeanceOutput(output(maxAllowed), [candidate(entry)])).toEqual({ ok: true });
    expect(validateSeanceOutput(output(maxAllowed + 2), [candidate(entry)])).toEqual({ ok: false, failedRules: ['REQUIREMENTS_FORMAT'] });
  });

  it('R10.8 returns the same verdict for the same input on repeated calls (Requirement 10)', () => {
    // Feature: 05-llm-pipeline-api, Property 12: Séance output validation
    fc.assert(
      fc.property(validSeanceCase, fc.option(seanceBreakerArb, { nil: undefined }), (base, breaker) => {
        const state = breaker ? breaker.apply(base) : base;
        const first = validateSeanceOutput(state.output, state.candidates);
        expect(validateSeanceOutput(state.output, state.candidates)).toEqual(first);
        expect(validateSeanceOutput(structuredClone(state.output), structuredClone(state.candidates))).toEqual(first);
      }),
      { numRuns: 100 },
    );
  });

  it('R10.3 treats a value of the wrong type, null, or a missing field as a failure of the matching rule (Requirement 10)', () => {
    const candidates = [candidate('calc_1')];
    for (const output of [null, undefined, 'text', 7, [], {}]) {
      const verdict = validateSeanceOutput(output, candidates);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.failedRules).toEqual(['REQUIREMENTS_FORMAT', 'DESIGN_FORMAT', 'INVARIANTS_SHAPE', 'ENTRY_FUNCTION_MATCH']);
    }
  });
});
