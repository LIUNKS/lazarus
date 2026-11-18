import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  REASON_APPROVE_FIRST,
  REASON_RUN_SEANCE_FIRST,
  REASON_VERIFY_OFF,
  resolveAccess,
  stageControls,
  summarizeStages,
  type StageAccess,
  type StageFacts,
} from './controls';
import type { VerificationState } from './verification';

const OWNER_ID = '3f6c1b2e-7a4d-4e8b-9c15-2d0a8b6f4e73';
const OTHER_ID = '9b2e4f61-3c7a-4d58-a1e0-6f8d2c5b7a94';
const STATES: Array<VerificationState | null> = ['VERIFIED', 'FAILED', 'NOT_RUN', 'INCOMPLETE', null];
const ACCESS: StageAccess[] = ['visitor', 'member-viewer', 'owner'];

const facts = (overrides: Partial<StageFacts> = {}): StageFacts => ({
  curseCount: 0,
  hasSeance: false,
  seanceApproved: false,
  hasReincarnation: false,
  verificationState: null,
  liveVerificationEnabled: true,
  ...overrides,
});

const factsArbitrary: fc.Arbitrary<StageFacts> = fc.record({
  curseCount: fc.integer({ min: 0, max: 6 }),
  hasSeance: fc.boolean(),
  seanceApproved: fc.boolean(),
  hasReincarnation: fc.boolean(),
  verificationState: fc.constantFrom(...STATES),
  liveVerificationEnabled: fc.boolean(),
});

describe('R7.6 resolveAccess', () => {
  it('gives visitor when there is no session, whatever the corpse is', () => {
    expect(resolveAccess(null, { isSample: true, userId: null })).toBe('visitor');
    expect(resolveAccess(null, { isSample: false, userId: OWNER_ID })).toBe('visitor');
  });

  it('gives owner only for a signed-in Member who owns a corpse that is not a sample', () => {
    expect(resolveAccess({ member: { id: OWNER_ID } }, { isSample: false, userId: OWNER_ID })).toBe('owner');
  });

  it.each([
    ['a sample', { isSample: true, userId: null }],
    ['a sample row that carries the Member id', { isSample: true, userId: OWNER_ID }],
    ['a corpse of another Member', { isSample: false, userId: OTHER_ID }],
    ['a corpse without an owner', { isSample: false, userId: null }],
  ])('gives member-viewer for a Member looking at %s', (_label, corpse) => {
    expect(resolveAccess({ member: { id: OWNER_ID } }, corpse)).toBe('member-viewer');
  });
});

describe('R8 stage controls gating', () => {
  it('R7.1 R8.1 to R8.6 R8.9 offers each control exactly under its rule, for every access and every combination of facts', () => {
    // Feature: 06-resurrection-ui, Property 2: Stage controls gating
    fc.assert(
      fc.property(fc.constantFrom(...ACCESS), factsArbitrary, (access, f) => {
        const controls = stageControls(access, f);
        const available = (key: keyof typeof controls) => controls[key].available;
        if (access !== 'owner') {
          const none = JSON.stringify({ available: false, reason: null });
          return (Object.keys(controls) as Array<keyof typeof controls>).every((key) => JSON.stringify(controls[key]) === none);
        }
        return (
          available('scan') === true &&
          available('seance') === !f.hasSeance &&
          available('approve') === (f.hasSeance && !f.seanceApproved) &&
          available('reincarnate') === (f.hasSeance && f.seanceApproved && !f.hasReincarnation) &&
          available('verify') === (f.hasReincarnation && f.verificationState === 'NOT_RUN' && f.liveVerificationEnabled)
        );
      }),
      { numRuns: 200 },
    );
  });

  it('R8.7 gives a reason only for a reincarnation that is not available because of an earlier stage', () => {
    // Feature: 06-resurrection-ui, Property 2: Stage controls gating
    fc.assert(
      fc.property(factsArbitrary, (f) => {
        const controls = stageControls('owner', f);
        const reasonOf = (state: (typeof controls)['scan']) => (state.available ? null : state.reason);
        const expectedReincarnation = f.hasReincarnation
          ? null
          : !f.hasSeance
            ? REASON_RUN_SEANCE_FIRST
            : !f.seanceApproved
              ? REASON_APPROVE_FIRST
              : null;
        return (
          reasonOf(controls.reincarnate) === expectedReincarnation &&
          reasonOf(controls.scan) === null &&
          reasonOf(controls.seance) === null &&
          reasonOf(controls.approve) === null &&
          reasonOf(controls.verify) === (f.hasReincarnation && f.verificationState === 'NOT_RUN' && !f.liveVerificationEnabled ? REASON_VERIFY_OFF : null)
        );
      }),
      { numRuns: 200 },
    );
  });

  it('R8.7 words the two reasons', () => {
    expect(REASON_RUN_SEANCE_FIRST).toBe('Run the séance first.');
    expect(REASON_APPROVE_FIRST).toBe('Approve the séance spec to enable reincarnation.');
  });

  it('R8.9 R18.10 withholds "Verify live" from an owner while the server has live verification off, and says why', () => {
    const stored = { hasSeance: true, seanceApproved: true, hasReincarnation: true, verificationState: 'NOT_RUN' } as const;
    expect(stageControls('owner', facts({ ...stored, liveVerificationEnabled: true })).verify).toEqual({ available: true });
    expect(stageControls('owner', facts({ ...stored, liveVerificationEnabled: false })).verify).toEqual({
      available: false,
      reason: REASON_VERIFY_OFF,
    });
    expect(REASON_VERIFY_OFF).toBe('Live verification is not available on this server.');
  });

  it('R8.9 gives no reason about verification when the stored state is already final, whether or not the server runs it', () => {
    for (const verificationState of ['VERIFIED', 'FAILED', 'INCOMPLETE'] as const) {
      const controls = stageControls('owner', facts({ hasSeance: true, seanceApproved: true, hasReincarnation: true, verificationState, liveVerificationEnabled: false }));
      expect(controls.verify).toEqual({ available: false, reason: null });
    }
  });

  it('R8.2 R8.3 an owner of a new corpse can scan and start the séance, and nothing else', () => {
    expect(stageControls('owner', facts())).toEqual({
      scan: { available: true },
      seance: { available: true },
      approve: { available: false, reason: null },
      reincarnate: { available: false, reason: REASON_RUN_SEANCE_FIRST },
      verify: { available: false, reason: null },
    });
  });

  it('R8.4 an owner with an unapproved séance can approve it, and is told to approve before reincarnation', () => {
    const controls = stageControls('owner', facts({ hasSeance: true }));
    expect(controls.approve).toEqual({ available: true });
    expect(controls.seance).toEqual({ available: false, reason: null });
    expect(controls.reincarnate).toEqual({ available: false, reason: REASON_APPROVE_FIRST });
  });

  it('R8.5 an owner with an approved séance and no reincarnation can start the reincarnation', () => {
    const controls = stageControls('owner', facts({ hasSeance: true, seanceApproved: true }));
    expect(controls.reincarnate).toEqual({ available: true });
    expect(controls.approve).toEqual({ available: false, reason: null });
  });

  it('R8.7 offers no regeneration once a result exists', () => {
    const controls = stageControls('owner', facts({ hasSeance: true, seanceApproved: true, hasReincarnation: true, verificationState: 'VERIFIED' }));
    expect(controls.seance.available).toBe(false);
    expect(controls.approve.available).toBe(false);
    expect(controls.reincarnate).toEqual({ available: false, reason: null });
  });

  it('R8.10 states in the doc comment that the approval condition is a UI-level restriction', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./controls.ts', import.meta.url), 'utf8');
    expect(source).toContain('UI-level restriction only');
    expect(source).toContain('Reincarnate_Route does not check `approved_at`');
  });
});

describe('R1.3 R1.4 summarizeStages', () => {
  it('names the three stages in order with their ids', () => {
    expect(summarizeStages(facts()).map(({ id, name }) => [id, name])).toEqual([
      ['hex-scanner', 'Hex Scanner'],
      ['seance-chamber', 'Séance Chamber'],
      ['laboratory', 'Laboratory'],
    ]);
  });

  it.each([
    [0, 'No curses stored'],
    [1, '1 curse stored'],
    [4, '4 curses stored'],
  ])('R1.4 words %s stored curses as "%s"', (curseCount, expected) => {
    expect(summarizeStages(facts({ curseCount }))[0]?.state).toBe(expected);
  });

  it.each([
    [{}, 'Not started'],
    [{ hasSeance: true }, 'Awaiting approval'],
    [{ hasSeance: true, seanceApproved: true }, 'Approved'],
  ])('R1.4 words the séance state %j as "%s"', (overrides, expected) => {
    expect(summarizeStages(facts(overrides))[1]?.state).toBe(expected);
  });

  it.each([
    [null, 'Not started'],
    ['VERIFIED', 'Verified'],
    ['FAILED', 'Failed'],
    ['NOT_RUN', 'Not verified yet'],
    ['INCOMPLETE', 'Incomplete'],
  ] as const)('R1.4 words the Laboratory state %s as "%s", read from the verification state', (verificationState, expected) => {
    expect(summarizeStages(facts({ hasReincarnation: verificationState !== null, verificationState }))[2]?.state).toBe(expected);
  });
});
