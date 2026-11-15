import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { StoreError } from './errors';
import {
  evidenceOf,
  formatThousands,
  nextStatusAfterReincarnation,
  nextStatusAfterSeance,
  reincarnationBody,
  scanBody,
  seanceBody,
  sortCurses,
  verificationOf,
} from './present';
import type { CorpseStatus, CurseRowOut, ReincarnationRow, ResultSource, SeanceRow } from './types';

const STATUSES: CorpseStatus[] = ['INFECTED', 'IN_SEANCE', 'RESURRECTED', 'FAILED'];
const SOURCES: ResultSource[] = ['precomputed', 'stored', 'cache', 'generated'];
const WORDS = /\b(verified|tested|proven|proof|equivalent)\b/i;
const CLAIM_WORDS = /\b(verified|proven|proof)\b/i;

const runs = fc.oneof(
  fc.constant(null),
  fc.integer({ min: -3, max: 3 }),
  fc.integer({ min: 995, max: 1005 }),
  fc.integer({ min: 0, max: 5_000_000 }),
  fc.constantFrom(0, 1, 999, 1_000, 1_001, 999_999, 1_000_000, 123_456_789),
);

const reincarnationRow = fc.record<ReincarnationRow>({
  id: fc.uuid(),
  corpseId: fc.uuid(),
  targetStack: fc.constantFrom('TypeScript (strict, ES2022)', 'TypeScript 6 (strict mode, ES2022)'),
  modernCode: fc.string({ maxLength: 60 }),
  pbtTestCode: fc.string({ maxLength: 60 }),
  pbtPassed: fc.constantFrom(true, false, null),
  totalRuns: runs,
  executionTimeMs: fc.option(fc.integer({ min: 0, max: 60_000 }), { nil: null }),
  createdAt: fc.date({ min: new Date('2026-01-01'), max: new Date('2027-01-01'), noInvalidDate: true }).map((d) => d.toISOString()),
});

/** Every string value of the response, except the two code fields. */
function textFields(value: unknown, key = ''): string[] {
  if (key === 'modernCode' || key === 'pbtTestCode') return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => textFields(item));
  if (typeof value === 'object' && value !== null) return Object.entries(value).flatMap(([k, v]) => textFields(v, k));
  return [];
}

describe('R12 verification, evidence, and wording (Requirements 12 and 19)', () => {
  it('R12.6 R12.7 maps pbt_passed to verification and builds evidence only for a passed run with a run count (Requirement 12)', () => {
    // Feature: 05-llm-pipeline-api, Property 17: Verification, evidence, and wording
    fc.assert(
      fc.property(reincarnationRow, (row) => {
        const verification = verificationOf(row.pbtPassed);
        expect(verification).toBe(row.pbtPassed === true ? 'VERIFIED' : row.pbtPassed === false ? 'FAILED' : 'NOT_RUN');
        const evidence = evidenceOf(row);
        const runCount = row.totalRuns;
        if (verification === 'VERIFIED' && runCount !== null && Number.isInteger(runCount) && runCount >= 0) {
          expect(evidence).toBe(`Verified behavioral equivalence across ${runCount.toLocaleString('en-US')} generated inputs.`);
        } else {
          expect(evidence).toBeNull();
        }
      }),
      { numRuns: 200 },
    );
  });

  it('R19.4 R19.5 keeps the restricted words out of every authored string for NOT_RUN and FAILED rows (Requirement 19)', () => {
    // Feature: 05-llm-pipeline-api, Property 17: Verification, evidence, and wording
    fc.assert(
      fc.property(reincarnationRow, fc.constantFrom(...SOURCES), fc.constantFrom(...STATUSES), (row, source, status) => {
        const body = reincarnationBody(source, row, { id: row.corpseId, status });
        if (body.reincarnation.verification === 'NOT_RUN') {
          expect(body.reincarnation.evidence).toBeNull();
          for (const text of textFields(body)) expect(WORDS.test(text), `NOT_RUN: ${text}`).toBe(false);
        }
        if (body.reincarnation.verification === 'FAILED') {
          expect(body.reincarnation.evidence).toBeNull();
          for (const text of textFields(body)) expect(CLAIM_WORDS.test(text), `FAILED: ${text}`).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('R12.5 returns the stored values unchanged and computes verification from the stored row (Requirement 12)', () => {
    // Feature: 05-llm-pipeline-api, Property 17: Verification, evidence, and wording
    fc.assert(
      fc.property(reincarnationRow, fc.constantFrom(...SOURCES), (row, source) => {
        const body = reincarnationBody(source, row, { id: row.corpseId, status: 'IN_SEANCE' });
        expect(body).toEqual({
          ok: true,
          source,
          reincarnation: {
            id: row.id,
            targetStack: row.targetStack,
            modernCode: row.modernCode,
            pbtTestCode: row.pbtTestCode,
            pbtPassed: row.pbtPassed,
            totalRuns: row.totalRuns,
            executionTimeMs: row.executionTimeMs,
            createdAt: row.createdAt,
            verification: verificationOf(row.pbtPassed),
            evidence: evidenceOf(row),
          },
          corpse: { id: row.corpseId, status: 'IN_SEANCE' },
        });
      }),
      { numRuns: 100 },
    );
  });

  it('R12.7 formats thousands with commas and gives no evidence for a missing, negative, or fractional count (Requirement 12)', () => {
    expect(formatThousands(0)).toBe('0');
    expect(formatThousands(999)).toBe('999');
    expect(formatThousands(1_000)).toBe('1,000');
    expect(formatThousands(1_234_567)).toBe('1,234,567');
    expect(evidenceOf({ pbtPassed: true, totalRuns: 1_000 })).toBe('Verified behavioral equivalence across 1,000 generated inputs.');
    expect(evidenceOf({ pbtPassed: true, totalRuns: 0 })).toBe('Verified behavioral equivalence across 0 generated inputs.');
    for (const totalRuns of [null, -1, 1.5, Number.NaN]) expect(evidenceOf({ pbtPassed: true, totalRuns })).toBeNull();
    for (const pbtPassed of [false, null]) expect(evidenceOf({ pbtPassed, totalRuns: 1_000 })).toBeNull();
  });

  it('R12.7 formatThousands round-trips: removing the commas gives the number, and groups have three digits (Requirement 12)', () => {
    // Feature: 05-llm-pipeline-api, Supporting check: thousands separators
    fc.assert(
      fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), (n) => {
        const text = formatThousands(n);
        expect(text.replaceAll(',', '')).toBe(String(n));
        const groups = text.split(',');
        expect(groups[0]!.length).toBeGreaterThanOrEqual(1);
        expect(groups[0]!.length).toBeLessThanOrEqual(3);
        for (const group of groups.slice(1)) expect(group).toHaveLength(3);
      }),
      { numRuns: 200 },
    );
  });
});

describe('R5.3 curse ordering (Requirement 5)', () => {
  const curse = fc.record<CurseRowOut>({
    curseType: fc.constantFrom('GLOBAL_POLLUTION', 'VAR_HOISTING', 'IMPLICIT_COERCION', 'CALLBACK_HELL', 'EVAL_INJECTION', 'PROTOTYPE_POLLUTION'),
    severity: fc.constantFrom('HEX', 'BLOOD_CURSE', 'FATAL'),
    lineNumber: fc.integer({ min: 1, max: 12 }),
    description: fc.string({ maxLength: 20 }),
    exorcismStrategy: fc.string({ maxLength: 20 }),
  });

  it('R5.3 orders by line number, then by curse type in code-unit order, without changing the input (Requirement 5)', () => {
    // Feature: 05-llm-pipeline-api, Supporting check: curse ordering
    fc.assert(
      fc.property(fc.array(curse, { maxLength: 30 }), (curses) => {
        const copy = structuredClone(curses);
        const sorted = sortCurses(curses);
        expect(curses).toEqual(copy);
        expect(sorted).toHaveLength(curses.length);
        for (let i = 1; i < sorted.length; i++) {
          const a = sorted[i - 1]!;
          const b = sorted[i]!;
          expect(a.lineNumber < b.lineNumber || (a.lineNumber === b.lineNumber && a.curseType <= b.curseType)).toBe(true);
        }
        expect(scanBody('generated', 3, sorted).curses.every((c) => Object.keys(c).sort().join() === 'curseType,description,exorcismStrategy,lineNumber,severity')).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

describe('R11 R14 status transitions (Requirements 11 and 14)', () => {
  it('R11.4 R11.5 moves INFECTED to IN_SEANCE only for generated or cache results, and never returns FAILED (Requirement 11)', () => {
    // Feature: 05-llm-pipeline-api, Supporting check: Séance status transition
    for (const source of SOURCES) {
      for (const current of STATUSES) {
        const next = nextStatusAfterSeance(source, current);
        const moves = (source === 'generated' || source === 'cache') && current === 'INFECTED';
        expect(next, `${source} ${current}`).toBe(moves ? 'IN_SEANCE' : current);
      }
    }
  });

  it('R14.4 R14.5 resurrects only for a passed run on a corpse that is not yet RESURRECTED (Requirement 14)', () => {
    // Feature: 05-llm-pipeline-api, Supporting check: reincarnation status transition
    for (const pbtPassed of [true, false, null]) {
      for (const current of STATUSES) {
        const next = nextStatusAfterReincarnation({ pbtPassed }, current);
        expect(next, `${String(pbtPassed)} ${current}`).toBe(pbtPassed === true ? 'RESURRECTED' : current);
      }
    }
  });
});

describe('R9.5 Seance body (Requirement 9)', () => {
  const row = (invariantsJson: unknown): SeanceRow => ({ id: 's1', corpseId: 'c1', requirementsMd: 'r', designMd: 'd', invariantsJson, approvedAt: null });
  const document = { entry_function: 'f', input: 'i', output: 'o', invariants: ['a', 'b', 'c'] };

  it('R9.5 returns the four-key invariants document and the unchanged strings (Requirement 9)', () => {
    expect(seanceBody('generated', row(document), { id: 'c1', status: 'IN_SEANCE' })).toEqual({
      ok: true,
      source: 'generated',
      seance: { id: 's1', requirementsMd: 'r', designMd: 'd', invariants: document, approvedAt: null },
      corpse: { id: 'c1', status: 'IN_SEANCE' },
    });
  });

  it('R9.5 throws a StoreError for a stored document with another shape (Requirement 9)', () => {
    const bad = [null, 'text', [], {}, { ...document, extra: 1 }, { ...document, input: 3 }, { ...document, invariants: 'x' }, { ...document, invariants: [1] }];
    for (const value of bad) expect(() => seanceBody('stored', row(value), { id: 'c1', status: 'INFECTED' }), JSON.stringify(value)).toThrow(StoreError);
  });
});
