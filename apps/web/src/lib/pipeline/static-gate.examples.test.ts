// One rejected example per rule of Requirement 13 (criteria 1 to 3 and 5 to 9) and one accepted example per seed language.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runStaticGate, type GateRule } from './static-gate';

const SEED_DIR = path.resolve(import.meta.dirname, '../../../../../db/seed');

const MODERN = 'export function calc(x: number): number {\n  return x + 1;\n}\n';
const TEST_BODY = 'return fc.property(fc.integer(), (n) => {\n  assertEquivalent(n);\n});\n';

function failedRulesOf(modernCode: string, pbtTestCode: string, entry: string | null = 'calc'): GateRule[] | 'ok' {
  const verdict = runStaticGate({ modernCode, pbtTestCode }, entry);
  return verdict.ok ? 'ok' : verdict.failedRules;
}

describe('R20.6 Static_Gate accepted examples from the seed files (Requirement 20)', () => {
  it.each(['batch-calculator', 'invoice-totals', 'query-string-parser'])(
    'R13.1 R13.10 accepts modern.ts and test-code.js of the seed %s (Requirement 13)',
    (name) => {
      const folder = path.join(SEED_DIR, name);
      const sample = JSON.parse(readFileSync(path.join(folder, 'sample.json'), 'utf8')) as { entryFunction: string };
      const modernCode = readFileSync(path.join(folder, 'modern.ts'), 'utf8');
      const pbtTestCode = readFileSync(path.join(folder, 'test-code.js'), 'utf8');
      expect(runStaticGate({ modernCode, pbtTestCode }, sample.entryFunction)).toEqual({ ok: true });
    },
    60_000,
  );

  it('R13.1 accepts the small baseline module and test body used by the rejected examples (Requirement 13)', () => {
    expect(failedRulesOf(MODERN, TEST_BODY)).toBe('ok');
  });
});

describe('R20.6 Static_Gate rejected examples, one per rule (Requirement 20)', () => {
  it('R13.1 rejects a module with a type error with MODERN_TYPECHECK (Requirement 13)', () => {
    const verdict = runStaticGate({ modernCode: "export function calc(x: number): number {\n  return 'text';\n}\n", pbtTestCode: TEST_BODY }, 'calc');
    expect(verdict).toMatchObject({ ok: false, failedRules: ['MODERN_TYPECHECK'] });
    if (!verdict.ok) {
      expect(verdict.diagnostics.length).toBeGreaterThan(0);
      expect(verdict.diagnostics[0]).toMatchObject({ line: 2, code: 2322 });
    }
  });

  it('R13.2 rejects an import with MODERN_NO_IMPORTS, and the compiler also cannot resolve it (Requirement 13)', () => {
    // No module can be resolved in the locked-down compiler host, so an import also fails the type-check rule.
    expect(failedRulesOf(`import { helper } from './helper';\n${MODERN}`, TEST_BODY)).toEqual(['MODERN_TYPECHECK', 'MODERN_NO_IMPORTS']);
  });

  it('R13.3 rejects a module that does not export the entry function with MODERN_ENTRY_EXPORT (Requirement 13)', () => {
    expect(failedRulesOf('function calc(x: number): number {\n  return x + 1;\n}\n', TEST_BODY)).toEqual(['MODERN_ENTRY_EXPORT']);
    expect(failedRulesOf(MODERN, TEST_BODY, 'other')).toEqual(['MODERN_ENTRY_EXPORT']);
    expect(failedRulesOf(MODERN, TEST_BODY, null)).toEqual(['MODERN_ENTRY_EXPORT']);
  });

  it('R13.5 rejects a var declaration with MODERN_FORBIDDEN_CONSTRUCTS (Requirement 13)', () => {
    expect(failedRulesOf('export function calc(x: number): number {\n  var y = x;\n  return y;\n}\n', TEST_BODY)).toEqual(['MODERN_FORBIDDEN_CONSTRUCTS']);
  });

  it('R13.6 rejects a test body that does not parse with TEST_SYNTAX (Requirement 13)', () => {
    expect(failedRulesOf(MODERN, 'const broken = ;\nreturn fc.property(fc.integer(), (n) => {\n  assertEquivalent(n);\n});\n')).toEqual(['TEST_SYNTAX']);
  });

  it('R13.7 rejects a test body that calls fc.assert or does not end in fc.property with TEST_CONTRACT (Requirement 13)', () => {
    expect(failedRulesOf(MODERN, 'fc.assert(fc.property(fc.integer(), (n) => {\n  assertEquivalent(n);\n}));\n')).toEqual(['TEST_CONTRACT']);
  });

  it('R13.8 rejects a test body that never references assertEquivalent with TEST_ASSERT_EQUIVALENT (Requirement 13)', () => {
    expect(failedRulesOf(MODERN, 'return fc.property(fc.integer(), (n) => n === n);\n')).toEqual(['TEST_ASSERT_EQUIVALENT']);
  });

  it('R13.9 rejects a Forbidden_Phrase inside a code comment with FORBIDDEN_PHRASE, as in the rejection of Forbidden_Phrases (Requirement 13)', () => {
    expect(failedRulesOf(`// The result is GUARANTEED to be right.\n${MODERN}`, TEST_BODY)).toEqual(['FORBIDDEN_PHRASE']);
  });
});
