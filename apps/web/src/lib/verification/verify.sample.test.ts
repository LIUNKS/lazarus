import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { errored, failed, passed } from '@/lib/testing/mock-sandbox';
import {
  buildVerifyHarness,
  checkVerifyResponse,
  DISABLED,
  INCONCLUSIVE_SANDBOX_CODES,
  MEMBER_ID,
  quotaScriptFor,
  SAMPLE_ID,
  SEED,
  storeState,
  verifyRequest,
} from '@/lib/testing/verification-arbitraries';
import { seanceRow } from '@/lib/testing/harness';
import { decideSampleExecution } from './execution';
import { handleVerify } from './verify';

const sampleRequest = () => verifyRequest({ corpseId: SAMPLE_ID });

function sampleHarness(options: Parameters<typeof buildVerifyHarness>[0] = {}) {
  return buildVerifyHarness({ ...storeState({ reincarnation: true, verdict: null, seance: 'valid' }), ...options });
}

describe('R13 live run of a sample corpse for a Member', () => {
  it('R13.2 builds the run request from the stored sample rows and the verified Member, with the server seed and run count', async () => {
    const harness = sampleHarness();
    const checked = await checkVerifyResponse(await handleVerify(sampleRequest(), harness.deps));
    expect(checked.status).toBe(200);
    expect(harness.sandbox.calls).toBe(1);
    const sample = harness.store.corpseOf(SAMPLE_ID);
    const request = harness.sandbox.requests[0];
    expect(request).toMatchObject({
      origin: 'sample',
      caller: { kind: 'member', userId: MEMBER_ID },
      corpusOwnerId: null,
      legacyCode: sample?.originalCode,
      entryFunction: 'calc',
      numRuns: 1_000,
      seed: SEED,
    });
  });

  it('R13.4 returns the run result with source "live" and writes no verdict, so the precomputed row is unchanged', async () => {
    for (const [result, passedValue, runs] of [
      [passed(1_000, 33), true, 1_000],
      [failed(9, 21), false, 9],
    ] as const) {
      const harness = sampleHarness({ results: [result] });
      const before = await harness.store.getReincarnation(SAMPLE_ID);
      const checked = await checkVerifyResponse(await handleVerify(sampleRequest(), harness.deps));
      expect(checked.body['source']).toBe('live');
      expect(checked.body['reincarnation']).toMatchObject({ pbtPassed: passedValue, totalRuns: runs });
      expect(harness.store.recordCalls).toBe(0);
      expect(harness.store.verdictWrites).toHaveLength(0);
      expect(await harness.store.getReincarnation(SAMPLE_ID)).toEqual(before);
    }
  });

  it('R13.3 runs a sample while the flag for user code is off, and stops when the kill switch is engaged or invalid', async () => {
    const userFlagOff = sampleHarness({ execution: DISABLED });
    expect((await checkVerifyResponse(await handleVerify(sampleRequest(), userFlagOff.deps))).body['source']).toBe('live');

    for (const state of ['engaged', 'invalid'] as const) {
      const harness = sampleHarness({ sampleExecution: decideSampleExecution(state) });
      const checked = await checkVerifyResponse(await handleVerify(sampleRequest(), harness.deps));
      expect(checked.code).toBe('VERIFICATION_DISABLED');
      expect(harness.sandbox.calls).toBe(0);
      expect(harness.store.quotaCalls).toBe(0);
    }
  });

  it('R13.3 decides sample runs from the kill switch only', () => {
    expect(decideSampleExecution('not-engaged')).toEqual({ enabled: true });
    expect(decideSampleExecution('engaged')).toEqual({ enabled: false, reason: 'kill-switch' });
    expect(decideSampleExecution('invalid')).toEqual({ enabled: false, reason: 'kill-switch-invalid' });
  });

  it('R13.2 answers SEANCE_REQUIRED without spending quota when the sample has no usable Seance spec', async () => {
    const state = storeState({ reincarnation: true, verdict: null, seance: 'valid' });
    for (const seances of [state.seances.filter((row) => row.corpseId !== SAMPLE_ID), [...state.seances.filter((row) => row.corpseId !== SAMPLE_ID), seanceRow(SAMPLE_ID, { invariantsJson: { input: 'a', output: 'b', invariants: [] } })]]) {
      const harness = buildVerifyHarness({ ...state, seances });
      const checked = await checkVerifyResponse(await handleVerify(sampleRequest(), harness.deps));
      expect(checked.code).toBe('SEANCE_REQUIRED');
      expect(harness.store.quotaCalls).toBe(0);
      expect(harness.sandbox.calls).toBe(0);
    }
  });

  it('R13.2 reserves quota once before the run, and a denial stops the run', async () => {
    const denied = sampleHarness({ quota: [quotaScriptFor('deny-user', 90)] });
    const checked = await checkVerifyResponse(await handleVerify(sampleRequest(), denied.deps));
    expect(checked.code).toBe('RATE_LIMITED');
    expect(checked.headers.get('retry-after')).toBe('90');
    expect(denied.sandbox.calls).toBe(0);

    const allowed = sampleHarness();
    await handleVerify(sampleRequest(), allowed.deps);
    expect(allowed.store.quotaCalls).toBe(1);
    const quotaIndex = allowed.store.calls.indexOf('reserveVerificationRun');
    expect(quotaIndex).toBeGreaterThanOrEqual(0);
    expect(quotaIndex).toBeLessThan(allowed.storeCallsAtRun[0] ?? -1);
  });

  it('R13.5 maps a run without a verdict to the same codes as an owned run, and stores nothing', async () => {
    // Feature: 08-live-verification-api, Supporting check: Sample runs share the result classification
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...INCONCLUSIVE_SANDBOX_CODES, 'SANDBOX_UNAVAILABLE', 'SOMETHING_NEW'), async (code) => {
        const harness = sampleHarness({ results: [errored(code)] });
        const checked = await checkVerifyResponse(await handleVerify(sampleRequest(), harness.deps), ['sentinel-sandbox-message-9c41']);
        const want = code === 'SANDBOX_UNAVAILABLE' ? 'SANDBOX_UNAVAILABLE' : code === 'SOMETHING_NEW' ? 'INTERNAL_ERROR' : 'VERIFICATION_INCONCLUSIVE';
        return checked.code === want && harness.store.recordCalls === 0 && harness.store.quotaCalls === 1;
      }),
      { numRuns: 100 },
    );
  });

  it('R13.6 logs one run line with the Member id and the seed, and no code or message text', async () => {
    const harness = sampleHarness();
    await handleVerify(sampleRequest(), harness.deps);
    const runs = harness.logs.filter((line) => line.event === 'verification_run');
    expect(runs).toEqual([
      { event: 'verification_run', route: 'verify', corpseId: SAMPLE_ID, userId: MEMBER_ID, status: 'PASSED', code: null, totalRuns: 1_000, executionTimeMs: 420, seed: SEED },
    ]);
  });

  it('R13.1 still gives a Visitor the precomputed sample row at no cost', async () => {
    const harness = sampleHarness({ memberId: null });
    const checked = await checkVerifyResponse(await handleVerify(sampleRequest(), harness.deps));
    expect(checked.body['source']).toBe('precomputed');
    expect(harness.sandbox.calls + harness.store.quotaCalls + harness.counters.executionReads).toBe(0);
  });
});
