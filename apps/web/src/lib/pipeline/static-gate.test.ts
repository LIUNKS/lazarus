import fc from 'fast-check';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  gateSeedArb,
  harmlessGateEdits,
  orderedGateRules as ordered,
  violationGateEditArb,
  type GateState as State,
} from '@/lib/testing/arbitraries';
import { runStaticGate, type GateRule } from './static-gate';

const verdictOf = (state: State) => runStaticGate({ modernCode: state.modernCode, pbtTestCode: state.pbtTestCode }, state.entry);
const failedOf = (state: State): GateRule[] | 'ok' => {
  const verdict = verdictOf(state);
  return verdict.ok ? 'ok' : verdict.failedRules;
};
const seed = gateSeedArb;
const harmlessEdits = harmlessGateEdits;
afterEach(() => {
  vi.restoreAllMocks();
});

describe('R13 Static_Gate (Requirement 13)', () => {
  it('R13.1 R13.10 accepts the seed modules after semantics-preserving edits (Requirement 13)', () => {
    // Feature: 05-llm-pipeline-api, Property 13: Static gate
    fc.assert(
      fc.property(seed, fc.subarray(harmlessEdits, { minLength: 0 }), (base, edits) => {
        const state = edits.reduce((current, edit) => edit.apply(current), base);
        expect(failedOf(state), edits.map((e) => e.id).join(', ')).toBe('ok');
      }),
      { numRuns: 100 },
    );
  }, 120_000);

  it('R13.1 R13.2 R13.3 R13.5 R13.6 R13.7 R13.8 R13.9 rejects each catalog violation with exactly the expected rules (Requirement 13)', () => {
    // Feature: 05-llm-pipeline-api, Property 13: Static gate
    fc.assert(
      fc.property(seed, violationGateEditArb, fc.subarray(harmlessEdits, { minLength: 0, maxLength: 2 }), (base, violation, harmless) => {
        const state = violation.apply(harmless.reduce((current, edit) => edit.apply(current), base));
        const verdict = verdictOf(state);
        expect(verdict.ok, violation.id).toBe(false);
        if (!verdict.ok) {
          expect(verdict.failedRules, violation.id).toEqual(ordered(violation.rules));
          expect(verdict.diagnostics.length).toBeLessThanOrEqual(10);
        }
      }),
      { numRuns: 100 },
    );
  }, 120_000);

  it('R13.10 reports the union of the failed rules when two edits break different rules (Requirement 13)', () => {
    // Feature: 05-llm-pipeline-api, Property 13: Static gate
    fc.assert(
      fc.property(seed, violationGateEditArb, violationGateEditArb, (base, first, second) => {
        const ids = new Set([first.id, second.id]);
        // Edits that are not independent: the same edit twice, two entry-export breakers (the second one edits
        // the already changed entry), and an ambient `process` declaration, which gives the `process` edit a declared name.
        fc.pre(first.id !== second.id);
        fc.pre(!(first.rules.includes('MODERN_ENTRY_EXPORT') && second.rules.includes('MODERN_ENTRY_EXPORT')));
        fc.pre(!(ids.has('ambient process') && ids.has('process')));
        const state = second.apply(first.apply(base));
        expect(failedOf(state), `${first.id} + ${second.id}`).toEqual(ordered([...first.rules, ...second.rules]));
      }),
      { numRuns: 100 },
    );
  }, 120_000);

  it('R13.10 returns the same verdict for the same input (Requirement 13)', () => {
    // Feature: 05-llm-pipeline-api, Property 13: Static gate
    fc.assert(
      fc.property(seed, fc.option(violationGateEditArb, { nil: undefined }), (base, violation) => {
        const state = violation ? violation.apply(base) : base;
        expect(verdictOf(state)).toEqual(verdictOf({ ...state }));
      }),
      { numRuns: 100 },
    );
  }, 120_000);

  it('R13.13 reads only allowlisted library files and writes no file, even for reference directives and imports (Requirement 13)', async () => {
    // Feature: 05-llm-pipeline-api, Property 13: Static gate
    vi.resetModules();
    const reads: string[] = [];
    const readFile = ts.sys.readFile.bind(ts.sys);
    vi.spyOn(ts.sys, 'readFile').mockImplementation((fileName, encoding) => {
      reads.push(fileName);
      return readFile(fileName, encoding);
    });
    const writes = vi.spyOn(ts.sys, 'writeFile');
    const fresh = await import('./static-gate');

    const hostile = [
      '/// <reference lib="dom" />',
      '/// <reference path="/etc/passwd" />',
      '/// <reference types="node" />',
      "import secret from '../../../.env';",
      MODERN_WITH_ENTRY,
    ].join('\n');
    const verdict = fresh.runStaticGate({ modernCode: hostile, pbtTestCode: 'return fc.property(fc.integer(), (n) => { assertEquivalent(n); });' }, 'calc');

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.failedRules).toContain('MODERN_TYPECHECK');
    expect(reads.length).toBeGreaterThan(0);
    for (const fileName of reads) {
      expect(fileName.replaceAll('\\', '/'), fileName).toMatch(/\/typescript\/lib\/lib\.(?:es|decorators)[\w.]*\.d\.ts$/);
    }
    expect(reads.some((fileName) => fileName.includes('lib.dom'))).toBe(false);
    expect(writes).not.toHaveBeenCalled();
  });

  it('R13.1 counts a cancelled type-check as a rejection of MODERN_TYPECHECK (Requirement 13)', () => {
    // Feature: 05-llm-pipeline-api, Supporting check: type-check timeout
    let tick = 0;
    const verdict = runStaticGate(
      { modernCode: MODERN_WITH_ENTRY, pbtTestCode: 'return fc.property(fc.integer(), (n) => { assertEquivalent(n); });' },
      'calc',
      { now: () => (tick += 1_000), typecheckTimeoutMs: 10 },
    );
    expect(verdict).toMatchObject({ ok: false, failedRules: ['MODERN_TYPECHECK'] });
    expect(runStaticGate({ modernCode: MODERN_WITH_ENTRY, pbtTestCode: 'return fc.property(fc.integer(), (n) => { assertEquivalent(n); });' }, 'calc')).toEqual({ ok: true });
  });

  it('R13.1 R13.6 rejects an empty module and an empty test body (Requirement 13)', () => {
    expect(runStaticGate({ modernCode: '', pbtTestCode: '' }, 'calc')).toMatchObject({
      ok: false,
      failedRules: ['MODERN_TYPECHECK', 'MODERN_ENTRY_EXPORT', 'TEST_SYNTAX', 'TEST_CONTRACT', 'TEST_ASSERT_EQUIVALENT'],
    });
  });

  it('R13.3 accepts an exported function-valued const and an export list for the entry function (Requirement 13)', () => {
    const body = 'return fc.property(fc.integer(), (n) => { assertEquivalent(n); });';
    expect(runStaticGate({ modernCode: 'export const calc = (x: number): number => x + 1;', pbtTestCode: body }, 'calc')).toEqual({ ok: true });
    expect(runStaticGate({ modernCode: 'function calc(x: number): number { return x + 1; }\nexport { calc };', pbtTestCode: body }, 'calc')).toEqual({ ok: true });
    expect(runStaticGate({ modernCode: 'export const calc = 5;', pbtTestCode: body }, 'calc')).toMatchObject({ ok: false, failedRules: ['MODERN_ENTRY_EXPORT'] });
  });
});

const MODERN_WITH_ENTRY = 'export function calc(x: number): number {\n  return x + 1;\n}';
