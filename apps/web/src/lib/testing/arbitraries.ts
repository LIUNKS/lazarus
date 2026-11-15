// fast-check generators shared by the Pipeline_API tests. Test-only: no production module imports this file.
// Generators that only one test file uses (request bodies, env maps, nested strings) stay next to that test.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { FORBIDDEN_PHRASES } from '@/lib/pipeline/forbidden';
import type { GateRule } from '@/lib/pipeline/static-gate';
import type { SeanceRule } from '@/lib/pipeline/seance-validate';
import type { CorpseStatus, EntryCandidate, SourceLanguage } from '@/lib/pipeline/types';

// ---------------------------------------------------------------------------------------------
// Identity, corpses, and provider outcome sequences
// ---------------------------------------------------------------------------------------------

export const uuidArb = fc.uuid();
export const statusArb: fc.Arbitrary<CorpseStatus> = fc.constantFrom('INFECTED', 'IN_SEANCE', 'RESURRECTED', 'FAILED');
export const languageArb: fc.Arbitrary<SourceLanguage> = fc.constantFrom('es3', 'es5-jquery', 'legacy-node');

export type CallerKind = 'visitor' | 'member';
export type CorpseKind = 'sample' | 'owned' | 'foreign' | 'missing';
export const callerArb: fc.Arbitrary<CallerKind> = fc.constantFrom('visitor', 'member');
export const corpseKindArb: fc.Arbitrary<CorpseKind> = fc.constantFrom('sample', 'owned', 'foreign', 'missing');

/** A provider outcome as a scripted step. `ok-*` steps carry a value chosen by the test. */
export type OutcomeStep = 'ok' | 'invalid-output' | 'provider-error' | 'timeout' | 'auth' | 'deadline' | 'disconnect';
export const outcomeStepArb: fc.Arbitrary<OutcomeStep> = fc.constantFrom('ok', 'invalid-output', 'provider-error', 'timeout', 'auth', 'deadline', 'disconnect');
export const outcomeSequenceArb: fc.Arbitrary<OutcomeStep[]> = fc.array(outcomeStepArb, { minLength: 1, maxLength: 3 });

/** The result of the quota call as the database could return it, before the verdict guard. */
export type QuotaStep = 'allow' | 'deny-user' | 'deny-global' | 'error' | 'malformed' | 'null';
export const quotaStepArb: fc.Arbitrary<QuotaStep> = fc.constantFrom('allow', 'deny-user', 'deny-global', 'error', 'malformed', 'null');

// ---------------------------------------------------------------------------------------------
// Séance outputs: one valid generator and breakers that each break exactly one rule
// ---------------------------------------------------------------------------------------------

export interface SeanceOutputShape {
  requirementsMd: string;
  designMd: string;
  invariants: Record<string, unknown>;
}
export interface SeanceCase {
  output: SeanceOutputShape;
  candidates: EntryCandidate[];
}
export interface SeanceBreaker {
  rule: SeanceRule;
  apply: (state: SeanceCase) => SeanceCase;
}

export const SEANCE_RULE_ORDER: SeanceRule[] = ['REQUIREMENTS_FORMAT', 'DESIGN_FORMAT', 'INVARIANTS_SHAPE', 'ENTRY_FUNCTION_MATCH', 'FORBIDDEN_PHRASE'];

const WORDS = ['value', 'total', 'input', 'list', 'rule', 'order', 'amount', 'result', 'record', 'count', 'string', 'number', 'items'];
const SUBJECTS = ['THE function', 'WHEN a caller passes a list, THE function', 'WHILE the list is empty, THE function', 'IF an item is missing, THE function', 'WHERE a flag is set, THE function'];
const words = (min: number, max: number) => fc.array(fc.constantFrom(...WORDS), { minLength: min, maxLength: max }).map((list) => list.join(' '));
const entryName = fc.stringMatching(/^[a-z]{3,8}_[0-9]{1,3}$/);

export const candidate = (name: string): EntryCandidate => ({ name, params: ['a'], pureCandidate: true, impurityMarkers: [] });

export const cyrillic = (count: number) => '\u043f\u0440\u0438\u0432\u0435\u0442'.repeat(Math.ceil(count / 6)).slice(0, count);
const accents = (latinLetters: number) => '\u00e9'.repeat(Math.floor((latinLetters * 0.04) / 0.96));
export const latinLetterCount = (text: string) => (text.match(/[A-Za-z]/g) ?? []).length;

export function earsLines(count: number, fillers: string[]): string[] {
  return Array.from({ length: count }, (_, i) => `${i + 1}. ${SUBJECTS[i % SUBJECTS.length]} SHALL return a ${fillers[i % fillers.length] ?? 'value'}.`);
}
export function lengthen(text: string, min: number): string {
  let result = text;
  while (result.length < min) result += `\nNote: ${WORDS.join(' ')}.`;
  return result;
}

const validRequirements = fc
  .tuple(fc.integer({ min: 3, max: 10 }), fc.array(words(2, 8), { minLength: 1, maxLength: 10 }), fc.boolean())
  .map(([count, fillers, withAccents]) => {
    const base = lengthen(`# Requirements\n${earsLines(count, fillers).join('\n')}`, 200);
    return withAccents ? `${base}\n${accents(latinLetterCount(base))}` : base;
  });

/** An output that satisfies rules 1 to 5 of Requirement 10, with the candidate list that makes its entry function valid. */
export const validSeanceCase: fc.Arbitrary<SeanceCase> = fc
  .tuple(entryName, fc.array(entryName, { maxLength: 2 }), validRequirements, words(0, 6), fc.array(words(1, 6), { minLength: 3, maxLength: 10 }), fc.constantFrom('', ' ', '  '))
  .map(([entry, others, requirementsMd, designWords, list, pad]) => ({
    candidates: [...others.filter((name) => name !== entry), entry].map(candidate),
    output: {
      requirementsMd,
      designMd: lengthen(`The function ${entry} accepts a value and returns a result. ${designWords}`, 100),
      invariants: { entry_function: entry, input: `${pad}a list of items${pad}`, output: `${pad}a number${pad}`, invariants: list },
    },
  }));

export const withOutput = (state: SeanceCase, changes: Partial<SeanceOutputShape>): SeanceCase => ({ ...state, output: { ...state.output, ...changes } });
export const withInvariants = (state: SeanceCase, changes: Record<string, unknown>): SeanceCase =>
  withOutput(state, { invariants: { ...state.output.invariants, ...changes } });
export const entryOf = (state: SeanceCase) => String(state.output.invariants['entry_function']);

export const SEANCE_BREAKERS: SeanceBreaker[] = [
  { rule: 'REQUIREMENTS_FORMAT', apply: (c) => withOutput(c, { requirementsMd: '1. THE a SHALL b.\n2. THE c SHALL d.\n3. THE e SHALL f.' }) },
  { rule: 'REQUIREMENTS_FORMAT', apply: (c) => withOutput(c, { requirementsMd: `${c.output.requirementsMd}\n${'filler words '.repeat(400)}` }) },
  { rule: 'REQUIREMENTS_FORMAT', apply: (c) => withOutput(c, { requirementsMd: `${c.output.requirementsMd}\n${cyrillic(latinLetterCount(c.output.requirementsMd))}` }) },
  { rule: 'REQUIREMENTS_FORMAT', apply: (c) => withOutput(c, { requirementsMd: lengthen(earsLines(2, ['value']).join('\n'), 200) }) },
  { rule: 'REQUIREMENTS_FORMAT', apply: (c) => withOutput(c, { requirementsMd: lengthen(earsLines(11, ['value']).join('\n'), 200) }) },
  { rule: 'REQUIREMENTS_FORMAT', apply: (c) => withOutput(c, { requirementsMd: lengthen('1. the function shall return a value.\n2. THE function returns a value.\n3. THE function must return.', 200) }) },
  { rule: 'DESIGN_FORMAT', apply: (c) => withOutput(c, { designMd: `Uses ${entryOf(c)}.` }) },
  { rule: 'DESIGN_FORMAT', apply: (c) => withOutput(c, { designMd: `${c.output.designMd} ${'more words '.repeat(300)}` }) },
  { rule: 'DESIGN_FORMAT', apply: (c) => withOutput(c, { designMd: lengthen('The function accepts a value and returns a result.', 100) }) },
  { rule: 'INVARIANTS_SHAPE', apply: (c) => withInvariants(c, { input: undefined }) },
  { rule: 'INVARIANTS_SHAPE', apply: (c) => withInvariants(c, { notes: 'extra key' }) },
  { rule: 'INVARIANTS_SHAPE', apply: (c) => withInvariants(c, { input: '   ' }) },
  { rule: 'INVARIANTS_SHAPE', apply: (c) => withInvariants(c, { output: 'x'.repeat(301) }) },
  { rule: 'INVARIANTS_SHAPE', apply: (c) => withInvariants(c, { output: 42 }) },
  { rule: 'INVARIANTS_SHAPE', apply: (c) => withInvariants(c, { invariants: ['one', 'two'] }) },
  { rule: 'INVARIANTS_SHAPE', apply: (c) => withInvariants(c, { invariants: Array.from({ length: 11 }, (_, i) => `item ${i}`) }) },
  { rule: 'INVARIANTS_SHAPE', apply: (c) => withInvariants(c, { invariants: ['one', ' ', 'three'] }) },
  { rule: 'INVARIANTS_SHAPE', apply: (c) => withInvariants(c, { invariants: ['one', 'two', 3] }) },
  { rule: 'INVARIANTS_SHAPE', apply: (c) => withInvariants(c, { invariants: 'not a list' }) },
  { rule: 'ENTRY_FUNCTION_MATCH', apply: (c) => ({ ...c, candidates: c.candidates.filter((x) => x.name !== entryOf(c)) }) },
  { rule: 'ENTRY_FUNCTION_MATCH', apply: (c) => ({ ...c, candidates: [] }) },
  { rule: 'ENTRY_FUNCTION_MATCH', apply: (c) => ({ ...c, candidates: c.candidates.map((x) => candidate(x.name.toUpperCase())) }) },
];

/** Inserts one Forbidden_Phrase, in any letter case, into the design or the requirements. */
export const forbiddenPhraseBreakers: fc.Arbitrary<SeanceBreaker> = fc
  .tuple(fc.constantFrom(...FORBIDDEN_PHRASES), fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }), fc.constantFrom('design' as const, 'requirements' as const))
  .map(([phrase, mask, place]) => ({
    rule: 'FORBIDDEN_PHRASE' as const,
    apply: (c: SeanceCase) => {
      const text = [...phrase].map((char, i) => (mask[i % mask.length] ? char.toUpperCase() : char)).join('');
      return place === 'design' ? withOutput(c, { designMd: `${c.output.designMd} ${text}` }) : withOutput(c, { requirementsMd: `${c.output.requirementsMd}\nNote: ${text}` });
    },
  }));

export const seanceBreakerArb = fc.constantFrom(...SEANCE_BREAKERS);

// ---------------------------------------------------------------------------------------------
// Static gate: seed modules and edits
// ---------------------------------------------------------------------------------------------

const SEED_DIR = path.resolve(import.meta.dirname, '../../../../../db/seed');

export interface GateState {
  modernCode: string;
  pbtTestCode: string;
  entry: string;
}
export interface GateEdit {
  id: string;
  /** The exact set of rules that must fail after the edit (the compiler also rejects what it cannot resolve). */
  rules: GateRule[];
  apply(state: GateState): GateState;
}

export const GATE_RULE_ORDER: GateRule[] = [
  'MODERN_TYPECHECK',
  'MODERN_NO_IMPORTS',
  'MODERN_ENTRY_EXPORT',
  'MODERN_FORBIDDEN_CONSTRUCTS',
  'TEST_SYNTAX',
  'TEST_CONTRACT',
  'TEST_ASSERT_EQUIVALENT',
  'FORBIDDEN_PHRASE',
];
export const orderedGateRules = (rules: Iterable<GateRule>): GateRule[] => {
  const set = new Set(rules);
  return GATE_RULE_ORDER.filter((rule) => set.has(rule));
};

/** The three seed modules, which pass the gate unchanged. */
export const gateSeeds: GateState[] = ['batch-calculator', 'invoice-totals', 'query-string-parser'].map((name) => {
  const folder = path.join(SEED_DIR, name);
  const sample = JSON.parse(readFileSync(path.join(folder, 'sample.json'), 'utf8')) as { entryFunction: string };
  return {
    modernCode: readFileSync(path.join(folder, 'modern.ts'), 'utf8'),
    pbtTestCode: readFileSync(path.join(folder, 'test-code.js'), 'utf8'),
    entry: sample.entryFunction,
  };
});
export const gateSeedArb = fc.constantFrom(...gateSeeds);

export const harmlessGateEdits: GateEdit[] = [
  { id: 'leading comment', rules: [], apply: (s) => ({ ...s, modernCode: `// leading note\n${s.modernCode}`, pbtTestCode: `// leading note\n${s.pbtTestCode}` }) },
  { id: 'trailing comment', rules: [], apply: (s) => ({ ...s, modernCode: `${s.modernCode}\n/* trailing note */\n`, pbtTestCode: `${s.pbtTestCode}\n// trailing note\n` }) },
  { id: 'CRLF line endings', rules: [], apply: (s) => ({ ...s, modernCode: s.modernCode.replaceAll('\n', '\r\n'), pbtTestCode: s.pbtTestCode.replaceAll('\n', '\r\n') }) },
  { id: 'unused helper', rules: [], apply: (s) => ({ ...s, modernCode: `${s.modernCode}\nfunction unusedHelper(value: number): number {\n  return value + 1;\n}\n` }) },
  { id: 'unchanged module-level let', rules: [], apply: (s) => ({ ...s, modernCode: `${s.modernCode}\nlet fixedValue = 1;\nexport const readFixed = (): number => fixedValue;\n` }) },
  {
    id: 'local bindings named like banned globals',
    rules: [],
    apply: (s) => ({
      ...s,
      // Every banned name is bound inside a function, so no other edit's module-level code can resolve to it.
      modernCode: `${s.modernCode}\nfunction localNames(process: number, fetch: number): number {\n  const Date = process + fetch;\n  const window = Date * 2;\n  function setTimeout(delay: number): number {\n    return delay + window;\n  }\n  return setTimeout(1);\n}\nexport const useLocal = (): number => localNames(1, 2);\n`,
    }),
  },
  {
    id: 'banned names as property names and members',
    rules: [],
    apply: (s) => ({
      ...s,
      modernCode: `${s.modernCode}\ninterface Api {\n  fetch(): number;\n  process: number;\n}\nconst api: Api = { fetch: () => 1, process: 2 };\nexport const readApi = (): number => api.fetch() + api.process;\n`,
    }),
  },
  {
    id: 'banned names only in comments and strings',
    rules: [],
    apply: (s) => ({
      ...s,
      modernCode: `${s.modernCode}\n// This note mentions setTimeout, Date, process, window, document, fetch, and Math.random.\nexport const note = 'globalThis eval require fetch Math.random';\n`,
    }),
  },
];

const appendModern = (id: string, snippet: string, rules: GateRule[]): GateEdit => ({ id, rules, apply: (s) => ({ ...s, modernCode: `${s.modernCode}\n${snippet}\n` }) });
export const modernGateEdits: GateEdit[] = [
  appendModern('type error', "const typeError: number = 'text';", ['MODERN_TYPECHECK']),
  { id: 'too long', rules: ['MODERN_TYPECHECK'], apply: (s) => ({ ...s, modernCode: `${s.modernCode}\n// ${'x'.repeat(30_000)}\n` }) },
  { id: 'import', rules: ['MODERN_TYPECHECK', 'MODERN_NO_IMPORTS'], apply: (s) => ({ ...s, modernCode: `import { helper } from './helper';\n${s.modernCode}` }) },
  appendModern('export from', "export { other } from './other';", ['MODERN_TYPECHECK', 'MODERN_NO_IMPORTS']),
  appendModern('dynamic import', "export const lazy = () => import('./lazy');", ['MODERN_TYPECHECK', 'MODERN_NO_IMPORTS']),
  appendModern('require call', "const required = require('library');", ['MODERN_TYPECHECK', 'MODERN_NO_IMPORTS', 'MODERN_FORBIDDEN_CONSTRUCTS']),
  { id: 'missing entry', rules: ['MODERN_ENTRY_EXPORT'], apply: (s) => ({ ...s, entry: `${s.entry}Missing` }) },
  { id: 'entry not exported', rules: ['MODERN_ENTRY_EXPORT'], apply: (s) => ({ ...s, modernCode: s.modernCode.replace(`export function ${s.entry}`, `function ${s.entry}`) }) },
  appendModern('var', 'var legacyVariable = 1;', ['MODERN_FORBIDDEN_CONSTRUCTS']),
  appendModern('any', 'const loose: any = 1;', ['MODERN_FORBIDDEN_CONSTRUCTS']),
  appendModern('eval', "const evaluated = eval('1');", ['MODERN_FORBIDDEN_CONSTRUCTS']),
  appendModern('new Function', "const built = new Function('return 1');", ['MODERN_FORBIDDEN_CONSTRUCTS']),
  appendModern('reassigned module let', 'let counter = 0;\nexport function bump(): number {\n  counter += 1;\n  return counter;\n}', ['MODERN_FORBIDDEN_CONSTRUCTS']),
  appendModern('destructuring write to module let', 'let first = 0;\nexport function reset(pair: number[]): void {\n  [first] = pair;\n}', ['MODERN_FORBIDDEN_CONSTRUCTS']),
  appendModern('global Date', 'const stamp = new Date(0);', ['MODERN_FORBIDDEN_CONSTRUCTS']),
  appendModern('globalThis', 'const root = globalThis;', ['MODERN_FORBIDDEN_CONSTRUCTS']),
  appendModern('Math.random', 'const diceDot = Math.random();', ['MODERN_FORBIDDEN_CONSTRUCTS']),
  appendModern("Math['random']", "const diceBracket = Math['random']();", ['MODERN_FORBIDDEN_CONSTRUCTS']),
  appendModern('setTimeout', 'setTimeout(() => 1, 1);', ['MODERN_TYPECHECK', 'MODERN_FORBIDDEN_CONSTRUCTS']),
  appendModern('setInterval', 'setInterval(() => 1, 1);', ['MODERN_TYPECHECK', 'MODERN_FORBIDDEN_CONSTRUCTS']),
  appendModern('process', 'const env = process;', ['MODERN_TYPECHECK', 'MODERN_FORBIDDEN_CONSTRUCTS']),
  appendModern('window', 'const win = window;', ['MODERN_TYPECHECK', 'MODERN_FORBIDDEN_CONSTRUCTS']),
  appendModern('document', 'const doc = document;', ['MODERN_TYPECHECK', 'MODERN_FORBIDDEN_CONSTRUCTS']),
  appendModern('fetch', "const request = fetch('x');", ['MODERN_TYPECHECK', 'MODERN_FORBIDDEN_CONSTRUCTS']),
  appendModern('ambient process', 'declare const process: { argv: string[] };\nexport const args = process.argv;', ['MODERN_FORBIDDEN_CONSTRUCTS']),
  appendModern('forbidden phrase in a comment', '// This result is guaranteed to be right.', ['FORBIDDEN_PHRASE']),
  appendModern('forbidden phrase in a string', "export const claim = '100% sure';", ['FORBIDDEN_PHRASE']),
];

const prependTest = (id: string, snippet: string, rules: GateRule[]): GateEdit => ({ id, rules, apply: (s) => ({ ...s, pbtTestCode: `${snippet}\n${s.pbtTestCode}` }) });
export const testGateEdits: GateEdit[] = [
  prependTest('syntax error', 'const broken = ;', ['TEST_SYNTAX']),
  { id: 'escapes the wrapper', rules: ['TEST_SYNTAX', 'TEST_CONTRACT', 'TEST_ASSERT_EQUIVALENT'], apply: (s) => ({ ...s, pbtTestCode: `}\nfunction escaped() {\n${s.pbtTestCode}` }) },
  { id: 'too long', rules: ['TEST_SYNTAX'], apply: (s) => ({ ...s, pbtTestCode: `${s.pbtTestCode}\n// ${'y'.repeat(10_000)}\n` }) },
  { id: 'no final return', rules: ['TEST_CONTRACT'], apply: (s) => ({ ...s, pbtTestCode: `${s.pbtTestCode}\nconst afterwards = 1;\n` }) },
  prependTest('fc.assert', 'fc.assert(fc.property(fc.integer(), () => true));', ['TEST_CONTRACT']),
  prependTest('fc.check', 'fc.check(fc.property(fc.integer(), () => true));', ['TEST_CONTRACT']),
  prependTest('numRuns property', 'const settings = { numRuns: 5 };', ['TEST_CONTRACT']),
  prependTest('numRuns shorthand', 'const settings = { numRuns };', ['TEST_CONTRACT']),
  prependTest('require call', "const lib = require('library');", ['TEST_CONTRACT']),
  prependTest('dynamic import', "const lazy = import('library');", ['TEST_CONTRACT']),
  prependTest('import declaration', "import library from 'library';", ['TEST_SYNTAX', 'TEST_CONTRACT']),
  prependTest('export declaration', 'export const exported = 1;', ['TEST_SYNTAX', 'TEST_CONTRACT']),
  {
    id: 'no assertEquivalent',
    rules: ['TEST_ASSERT_EQUIVALENT'],
    apply: (s) => ({ ...s, pbtTestCode: `${s.pbtTestCode.replaceAll('assertEquivalent', 'otherCheck')}\n// assertEquivalent is only named in this comment\n` }),
  },
  prependTest('forbidden phrase in a string', "const note = 'mathematical proof';", ['FORBIDDEN_PHRASE']),
];

export const violationGateEdits: GateEdit[] = [...modernGateEdits, ...testGateEdits];
export const violationGateEditArb = fc.constantFrom(...violationGateEdits);
