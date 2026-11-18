import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { StoreError } from '@/lib/pipeline/errors';
import {
  buildVerifyHarness,
  callerArb,
  checkVerifyResponse,
  corpseIdOf,
  corpseKindArb,
  MEMBER_ID,
  storeState,
  verifyRequest,
} from '@/lib/testing/verification-arbitraries';
import { handleVerify } from './verify';

describe('access resolution', () => {
  it('R3.4 R3.5 R13.1 gives the stored row of a sample to a Visitor, a live run to a Member, and identical denials for missing and foreign corpses (Requirement 3)', async () => {
    // Feature: 08-live-verification-api, Property 3: Access resolution
    const bodies = new Map<string, string>();
    await fc.assert(
      fc.asyncProperty(callerArb, corpseKindArb, fc.boolean(), async (caller, corpse, sampleHasRow) => {
        const state = storeState({ reincarnation: true, verdict: null, seance: 'valid' });
        const reincarnations = sampleHasRow ? state.reincarnations : state.reincarnations.filter((row) => row.corpseId !== corpseIdOf('sample'));
        const harness = buildVerifyHarness({ memberId: caller === 'member' ? MEMBER_ID : null, ...state, reincarnations });
        const checked = await checkVerifyResponse(await handleVerify(verifyRequest({ corpseId: corpseIdOf(corpse) }), harness.deps));
        const noCost = harness.sandbox.calls === 0 && harness.store.quotaCalls === 0 && harness.store.writes.length === 0;

        if (corpse === 'sample') {
          if (!sampleHasRow) return noCost && checked.code === 'NOT_PRECOMPUTED';
          if (caller === 'visitor') return noCost && checked.status === 200 && checked.body['source'] === 'precomputed';
          // A Member runs the sample live: one reservation and one run, and no verdict is written.
          return (
            checked.status === 200 &&
            checked.body['source'] === 'live' &&
            harness.sandbox.calls === 1 &&
            harness.store.quotaCalls === 1 &&
            harness.store.verdictWrites.length === 0
          );
        }
        if (caller === 'visitor' || corpse !== 'owned') {
          const code = caller === 'visitor' ? 'AUTH_REQUIRED' : 'NOT_FOUND';
          // Every denial with one code has one byte-identical body, so it never reveals whether a corpse exists.
          const first = bodies.get(code) ?? checked.text;
          bodies.set(code, first);
          return noCost && checked.code === code && checked.text === first;
        }
        return checked.status === 200 && checked.body['source'] === 'executed';
      }),
      { numRuns: 150 },
    );
    expect([...bodies.keys()].sort()).toEqual(['AUTH_REQUIRED', 'NOT_FOUND']);
  });

  it('R3.7 a failing session or corpse query gives INTERNAL_ERROR and nothing else happens (Requirement 3)', async () => {
    const throwing = buildVerifyHarness({ sessionThrows: true });
    const first = await checkVerifyResponse(await handleVerify(verifyRequest({ corpseId: corpseIdOf('owned') }), throwing.deps), ['sentinel-session-error']);
    expect(first.code).toBe('INTERNAL_ERROR');

    const failing = buildVerifyHarness();
    failing.store.failOn('loadCorpse', new StoreError('08006'));
    const second = await checkVerifyResponse(await handleVerify(verifyRequest({ corpseId: corpseIdOf('owned') }), failing.deps));
    expect(second.code).toBe('INTERNAL_ERROR');

    for (const harness of [throwing, failing]) {
      expect(harness.sandbox.calls + harness.store.quotaCalls + harness.store.writes.length + harness.counters.executionReads).toBe(0);
    }
  });
});
