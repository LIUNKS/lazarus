import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { StoreError } from '@/lib/pipeline/errors';
import { failed, passed } from '@/lib/testing/mock-sandbox';
import { buildVerifyHarness, checkVerifyResponse, OWNED_ID, storeState, verifyRequest } from '@/lib/testing/verification-arbitraries';
import { handleVerify } from './verify';

type Race = 'none' | 'competing-pass' | 'competing-fail' | 'record-error' | 'reread-error';

describe('persistence', () => {
  it('R7.6 records once and answers executed, stored, or PERSISTENCE_FAILED as Requirement 7 states', async () => {
    // Feature: 08-live-verification-api, Property 6: Persistence and race
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.integer({ min: 1, max: 1_000 }),
        fc.constantFrom('INFECTED' as const, 'IN_SEANCE' as const, 'RESURRECTED' as const, 'FAILED' as const),
        fc.constantFrom<Race>('none', 'competing-pass', 'competing-fail', 'record-error', 'reread-error'),
        async (pass, runs, status, race) => {
          const totalRuns = pass ? Math.max(100, runs) : runs;
          const harness = buildVerifyHarness({
            ...storeState({ reincarnation: true, verdict: null, seance: 'valid', status }),
            results: [pass ? passed(totalRuns) : failed(totalRuns)],
          });
          if (race === 'competing-pass' || race === 'competing-fail' || race === 'reread-error') {
            harness.store.beforeRecord = (store) => {
              if (race === 'reread-error') return;
              store.storeVerdict(OWNED_ID, { pbtPassed: race === 'competing-pass', totalRuns: race === 'competing-pass' ? 1_000 : 3, executionTimeMs: 9 });
            };
          }
          if (race === 'record-error') harness.store.failOn('recordVerification', new StoreError('40001'));
          if (race === 'reread-error') {
            // A competing verdict makes the record call update nothing, and only the re-read after it fails.
            harness.store.beforeRecord = (store) => {
              store.storeVerdict(OWNED_ID, { pbtPassed: true, totalRuns: 1_000, executionTimeMs: 9 });
              store.failOn('getReincarnation', new StoreError('08006'), 1);
            };
          }

          const checked = await checkVerifyResponse(await handleVerify(verifyRequest({ corpseId: OWNED_ID }), harness.deps));
          const records = harness.store.verdictWrites;
          const stored = harness.store.reincarnationOf(OWNED_ID);
          const corpseStatus = harness.store.corpseOf(OWNED_ID)?.status;

          if (harness.store.recordCalls !== 1) return false;
          if (race === 'reread-error') return checked.code === 'PERSISTENCE_FAILED' && records.length === 1 && !records[0]!.updated;
          if (race === 'record-error') return checked.code === 'PERSISTENCE_FAILED' && !checked.text.includes('"executed"') && records.length === 0;

          if (race === 'none') {
            const terminal = status === 'RESURRECTED' || status === 'FAILED';
            const expectedStatus = terminal ? status : pass ? 'RESURRECTED' : 'FAILED';
            const body = checked.body as { source: string; reincarnation: { pbtPassed: boolean; totalRuns: number }; corpse: { status: string } };
            return (
              checked.status === 200 &&
              body.source === 'executed' &&
              body.reincarnation.pbtPassed === pass &&
              body.reincarnation.totalRuns === totalRuns &&
              body.corpse.status === expectedStatus &&
              corpseStatus === expectedStatus &&
              records.length === 1 &&
              records[0]!.updated
            );
          }

          // A competing verdict was stored first: this run's result is discarded and the stored one is returned.
          const winner = race === 'competing-pass';
          const body = checked.body as { source: string; reincarnation: { pbtPassed: boolean; totalRuns: number } };
          return (
            checked.status === 200 &&
            body.source === 'stored' &&
            body.reincarnation.pbtPassed === winner &&
            stored?.pbtPassed === winner &&
            records.length === 1 &&
            !records[0]!.updated
          );
        },
      ),
      { numRuns: 150 },
    );
  });

  it('R7.12 two racing requests end with one stored verdict and equal values in both responses (Requirement 7)', async () => {
    const harness = buildVerifyHarness({ ...storeState({ reincarnation: true, verdict: null, seance: 'valid' }), results: [passed(1_000), failed(4)] });
    const [first, second] = await Promise.all([
      handleVerify(verifyRequest({ corpseId: OWNED_ID }), harness.deps),
      handleVerify(verifyRequest({ corpseId: OWNED_ID }), harness.deps),
    ]);
    const a = await checkVerifyResponse(first);
    const b = await checkVerifyResponse(second);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body['reincarnation']).toEqual(b.body['reincarnation']);
    expect(harness.store.verdictWrites.filter((write) => write.updated)).toHaveLength(1);
  });

  it('R7.8 a record call that updates nothing and a row without a verdict give PERSISTENCE_FAILED (Requirement 7)', async () => {
    // The row is not writable for this caller (another owner), so nothing is updated and the re-read has no verdict.
    const harness = buildVerifyHarness(storeState({ reincarnation: true, verdict: null, seance: 'valid' }));
    harness.store.recordVerification = async () => ({ wasUpdated: false });
    const checked = await checkVerifyResponse(await handleVerify(verifyRequest({ corpseId: OWNED_ID }), harness.deps));
    expect(checked.code).toBe('PERSISTENCE_FAILED');
  });

  it('R7.11 never updates or deletes a stored verdict (Requirement 7)', async () => {
    for (const verdict of [true, false]) {
      const harness = buildVerifyHarness(storeState({ reincarnation: true, verdict, seance: 'valid' }));
      const checked = await checkVerifyResponse(await handleVerify(verifyRequest({ corpseId: OWNED_ID }), harness.deps));
      expect(checked.body['source']).toBe('stored');
      expect(harness.store.recordCalls).toBe(0);
      expect(harness.store.writes).toEqual([]);
    }
  });
});
