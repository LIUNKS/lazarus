// Builders and arbitraries for the stage screens (06-resurrection-ui). Test-only: no production module imports this file.
import fc from 'fast-check';
import type { Viewer } from '@/lib/auth/viewer';
import type { CorpseDetail, CurseRow, Reincarnation, SeanceSpec } from '@/lib/data/types';
import { stageControls, type StageAccess, type StageControls, type StageFacts } from '@/lib/stages/controls';
import { verificationState } from '@/lib/stages/verification';

export const CORPSE_ID = '3f6c1b2e-7a4d-4e8b-9c15-2d0a8b6f4e73';
export const OWNER_ID = '9b2e4f61-3c7a-4d58-a1e0-6f8d2c5b7a94';

/** The text of an attack that must be shown as characters. */
export const SCRIPT_TEXT = '<script>alert(1)</script>';
export const SCRIPT_ESCAPED = '&lt;script&gt;alert(1)&lt;/script&gt;';

export function curseRow(overrides: Partial<CurseRow> = {}): CurseRow {
  return {
    id: 'curse-1',
    curseType: 'VAR_HOISTING',
    severity: 'HEX',
    lineNumber: 2,
    description: 'A var declaration is hoisted.',
    exorcismStrategy: 'Use const or let.',
    ...overrides,
  };
}

export function seanceSpec(overrides: Partial<SeanceSpec> = {}): SeanceSpec {
  return {
    id: 'seance-1',
    requirementsMd: '# Requirements\n1. THE function SHALL return a number.\n2. WHEN the input is empty, THE function SHALL return `0`.',
    designMd: '## Design\nUses `Math.round`.\n```ts\nconst a = 1;\n```',
    invariants: {
      entryFunction: 'computeTotal',
      input: 'object { items: number[] }',
      output: 'number',
      invariants: ['The result is never negative.', 'The result is rounded to two decimals.'],
    },
    approvedAt: '2026-01-02T03:04:05+00:00',
    ...overrides,
  };
}

export function reincarnation(overrides: Partial<Reincarnation> = {}): Reincarnation {
  return {
    id: 'reincarnation-1',
    targetStack: 'TypeScript 6 (strict mode, ES2022)',
    modernCode: 'export function computeTotal(a: number): number {\n  return a;\n}\n',
    pbtTestCode: 'return fc.property(fc.integer(), function (n) { assertEquivalent(n); });',
    pbtPassed: true,
    totalRuns: 1000,
    executionTimeMs: 842,
    createdAt: '2026-01-02T03:04:05+00:00',
    ...overrides,
  };
}

export function corpseDetail(overrides: Partial<CorpseDetail> = {}): CorpseDetail {
  const curses = overrides.curses ?? [curseRow()];
  return {
    id: CORPSE_ID,
    title: 'Invoice totals',
    sourceLanguage: 'es3',
    status: 'INFECTED',
    createdAt: '2026-01-02T03:04:05+00:00',
    isSample: false,
    curseCount: curses.length,
    originalCode: 'function computeTotal(a) {\n  var b = a;\n  return b;\n}\n',
    repoUrl: null,
    userId: OWNER_ID,
    curses,
    ...overrides,
  };
}

export function viewerOf(memberId: string): Viewer {
  return { member: { id: memberId, email: 'member@example.test' }, displayName: 'Member', avatarUrl: null };
}

/** The controls the page computes from what is stored, so a test does not repeat the page logic. */
export function controlsFor(access: StageAccess, seance: SeanceSpec | null, stored: Reincarnation | null): StageControls {
  const facts: StageFacts = {
    curseCount: 0,
    hasSeance: seance !== null,
    seanceApproved: seance !== null && seance.approvedAt !== null,
    hasReincarnation: stored !== null,
    verificationState: stored === null ? null : verificationState(stored),
    liveVerificationEnabled: true,
  };
  return stageControls(access, facts);
}

/** A stored string. It never holds text that a Visitor page must not contain, so such text cannot cause a false failure. */
const storedText = fc
  .oneof(fc.string({ maxLength: 30 }), fc.constant(SCRIPT_TEXT), fc.constant(`${SCRIPT_TEXT} & "quoted"`))
  .filter((text) => !text.includes('/api/') && !text.includes('Verify live') && !text.includes('data-stage-actions'));

export const seanceArbitrary: fc.Arbitrary<SeanceSpec | null> = fc.option(
  fc.record({
    id: fc.constant('seance-generated'),
    requirementsMd: storedText,
    designMd: storedText,
    invariants: fc.option(
      fc.record({
        entryFunction: storedText.filter((text) => text !== ''),
        input: storedText.filter((text) => text !== ''),
        output: storedText.filter((text) => text !== ''),
        invariants: fc.array(storedText, { maxLength: 3 }),
      }),
      { nil: null },
    ),
    approvedAt: fc.option(fc.constant('2026-01-02T03:04:05+00:00'), { nil: null }),
  }),
  { nil: null },
);

export const reincarnationArbitrary: fc.Arbitrary<Reincarnation | null> = fc.option(
  fc.record({
    id: fc.constant('reincarnation-generated'),
    targetStack: storedText,
    modernCode: storedText,
    pbtTestCode: storedText,
    pbtPassed: fc.constantFrom<boolean | null>(true, false, null),
    totalRuns: fc.oneof(fc.integer({ min: -3, max: 5000 }), fc.constant(null)),
    executionTimeMs: fc.oneof(fc.integer({ min: -3, max: 100000 }), fc.constant(null)),
    createdAt: fc.constant('2026-01-02T03:04:05+00:00'),
  }),
  { nil: null },
);

export const cursesArbitrary: fc.Arbitrary<CurseRow[]> = fc.array(
  fc.record({
    id: fc.uuid(),
    curseType: fc.constantFrom('GLOBAL_POLLUTION', 'VAR_HOISTING', 'EVAL_INJECTION'),
    severity: fc.constantFrom('HEX', 'BLOOD_CURSE', 'FATAL'),
    lineNumber: fc.integer({ min: 0, max: 8 }),
    description: storedText,
    exorcismStrategy: storedText,
  }),
  { maxLength: 4 },
);
