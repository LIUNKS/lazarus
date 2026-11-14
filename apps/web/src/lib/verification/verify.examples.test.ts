import { describe, expect, it } from 'vitest';
import { denied, errored, failed, passed } from '@/lib/testing/mock-sandbox';
import {
  buildVerifyHarness,
  checkVerifyResponse,
  DENIAL_REASONS,
  DISABLED,
  INCONCLUSIVE_SANDBOX_CODES,
  MEMBER_ID,
  OWNED_ID,
  SEED,
  seanceFor,
  storeState,
  verifyRequest,
} from '@/lib/testing/verification-arbitraries';
import { seanceRow } from '@/lib/testing/harness';
import { VERIFY_ERROR_CODES } from './errors';
import { handleVerify } from './verify';

const ready = () => storeState({ reincarnation: true, verdict: null, seance: 'valid' });
const run = async (harness: ReturnType<typeof buildVerifyHarness>, request = verifyRequest({ corpseId: OWNED_ID })) =>
  checkVerifyResponse(await handleVerify(request, harness.deps), ['sentinel-sandbox-message-9c41']);

/** A JSON body of exactly `bytes` bytes: the valid object padded with spaces, which JSON allows. */
const bodyOfSize = (bytes: number) => {
  const json = JSON.stringify({ corpseId: OWNED_ID });
  return `${json}${' '.repeat(bytes - json.length)}`;
};

describe('request body and header examples (Requirement 11 criterion 4)', () => {
  const rejected: [string, Request, string][] = [
    ['a missing corpseId key', verifyRequest({}), 'INVALID_REQUEST'],
    ['an extra key', verifyRequest({ corpseId: OWNED_ID, numRuns: 5 }), 'INVALID_REQUEST'],
    ['a value that is not a UUID', verifyRequest({ corpseId: 'abc' }), 'INVALID_REQUEST'],
    ['a JSON array body', verifyRequest([OWNED_ID]), 'INVALID_REQUEST'],
    ['a body of 1,025 bytes', verifyRequest(null, { raw: bodyOfSize(1_025) }), 'REQUEST_TOO_LARGE'],
    ['a wrong content type', verifyRequest({ corpseId: OWNED_ID }, { contentType: 'text/plain' }), 'UNSUPPORTED_MEDIA_TYPE'],
    ['a missing Origin', verifyRequest({ corpseId: OWNED_ID }, { origin: null }), 'FORBIDDEN_ORIGIN'],
    ['a different Origin', verifyRequest({ corpseId: OWNED_ID }, { origin: 'https://evil.example' }), 'FORBIDDEN_ORIGIN'],
  ];
  it.each(rejected)('R11.4 rejects %s with an envelope, no sandbox call, and no write (Requirement 11)', async (_label, request, code) => {
    const harness = buildVerifyHarness(ready());
    const checked = await run(harness, request);
    expect(checked.code).toBe(code);
    expect(harness.sandbox.calls).toBe(0);
    expect(harness.store.writes).toEqual([]);
    expect(harness.counters.sessions).toBe(0);
  });

  it('R11.4 accepts a valid body, including one of exactly 1,024 bytes (Requirement 11)', async () => {
    for (const request of [verifyRequest({ corpseId: OWNED_ID }), verifyRequest(null, { raw: bodyOfSize(1_024) })]) {
      const checked = await run(buildVerifyHarness(ready()), request);
      expect(checked.status).toBe(200);
      expect(checked.body['source']).toBe('executed');
    }
  });
});

describe('sandbox result examples (Requirement 11 criterion 6)', () => {
  it.each(INCONCLUSIVE_SANDBOX_CODES)('R7.4 %s gives 422 VERIFICATION_INCONCLUSIVE, writes nothing, and keeps the reservation (Requirement 7)', async (code) => {
    const harness = buildVerifyHarness({ ...ready(), results: [errored(code)] });
    expect((await run(harness)).code).toBe('VERIFICATION_INCONCLUSIVE');
    expect(harness.store.writes).toEqual([{ kind: 'quota.reserve' }]);
  });

  it.each(['INVALID_OPTIONS', 'INTERNAL_ERROR', 'A_FUTURE_CODE'])('R7.4 %s gives 500 INTERNAL_ERROR and keeps the reservation (Requirement 7)', async (code) => {
    const harness = buildVerifyHarness({ ...ready(), results: [errored(code)] });
    expect((await run(harness)).code).toBe('INTERNAL_ERROR');
    expect(harness.store.writes).toEqual([{ kind: 'quota.reserve' }]);
  });

  it.each(DENIAL_REASONS)('R6.6 the denial reason %s gives the code of Requirement 6 and keeps the reservation', async (reason) => {
    const harness = buildVerifyHarness({ ...ready(), results: [denied(reason)] });
    const checked = await run(harness);
    if (reason === 'USER_EXECUTION_DISABLED') expect(checked.code).toBe('VERIFICATION_DISABLED');
    else if (reason === 'USER_CONCURRENCY_LIMIT' || reason === 'GLOBAL_CONCURRENCY_LIMIT') {
      expect(checked.code).toBe('VERIFICATION_BUSY');
      expect(checked.headers.get('retry-after')).toBe('15');
    } else expect(checked.code).toBe('INTERNAL_ERROR');
    expect(harness.store.writes).toEqual([{ kind: 'quota.reserve' }]);
  });

  it('R6.7 SANDBOX_UNAVAILABLE gives 503, writes nothing, and keeps the reservation (Requirement 6)', async () => {
    const harness = buildVerifyHarness({ ...ready(), results: [errored('SANDBOX_UNAVAILABLE')] });
    expect((await run(harness)).code).toBe('SANDBOX_UNAVAILABLE');
    expect(harness.store.writes).toEqual([{ kind: 'quota.reserve' }]);
  });
});

describe('run examples', () => {
  it('R7.7 a passing run sets RESURRECTED and a failing run sets FAILED (Requirement 7)', async () => {
    const pass = buildVerifyHarness({ ...ready(), results: [passed(1_000, 420)] });
    const passBody = (await run(pass)).body as { source: string; reincarnation: Record<string, unknown>; corpse: { status: string } };
    expect(passBody).toMatchObject({
      source: 'executed',
      reincarnation: { pbtPassed: true, totalRuns: 1_000, executionTimeMs: 420, verification: 'VERIFIED', evidence: 'Verified behavioral equivalence across 1,000 generated inputs.' },
      corpse: { status: 'RESURRECTED' },
    });

    const fail = buildVerifyHarness({ ...ready(), results: [failed(7, 130)] });
    const failBody = (await run(fail)).body as { reincarnation: Record<string, unknown>; corpse: { status: string } };
    expect(failBody).toMatchObject({ reincarnation: { pbtPassed: false, totalRuns: 7, verification: 'FAILED', evidence: null }, corpse: { status: 'FAILED' } });
    expect(fail.store.corpseOf(OWNED_ID)?.status).toBe('FAILED');
  });

  it('R6.1 R6.2 builds the run request from the stored rows and fixed values only (Requirement 6)', async () => {
    const harness = buildVerifyHarness(ready());
    await run(harness);
    const [request] = harness.sandbox.requests;
    const row = harness.store.reincarnationOf(OWNED_ID)!;
    expect(request).toEqual({
      origin: 'user',
      caller: { kind: 'member', userId: MEMBER_ID },
      corpusOwnerId: MEMBER_ID,
      legacyCode: harness.store.corpseOf(OWNED_ID)!.originalCode,
      modernCode: row.modernCode,
      testCode: row.pbtTestCode,
      entryFunction: 'calc',
      numRuns: 1_000,
      seed: SEED,
    });
    expect(request).not.toHaveProperty('allowDynamicCode');
    expect(request).not.toHaveProperty('limits');
  });

  it('R6.3 R9.6 logs one run line with the seed and the user id, and no code or message text (Requirement 9)', async () => {
    const harness = buildVerifyHarness({ ...ready(), results: [errored('SANDBOX_TIMEOUT')] });
    await run(harness);
    const lines = harness.logs.filter((line) => line.event === 'verification_run');
    expect(lines).toEqual([
      { event: 'verification_run', route: 'verify', corpseId: OWNED_ID, userId: MEMBER_ID, status: 'ERROR', code: 'SANDBOX_TIMEOUT', totalRuns: null, executionTimeMs: 12, seed: SEED },
    ]);
    const text = JSON.stringify(harness.logs);
    expect(text).not.toContain('sentinel-sandbox-message');
    expect(text).not.toContain(harness.store.corpseOf(OWNED_ID)!.originalCode.slice(0, 20));
  });

  it.each([
    ['a missing Seance row', seanceFor('missing')],
    ['an empty entry_function', seanceFor('empty-entry')],
    ['no entry_function key', seanceFor('no-entry')],
    ['an entry_function that is not a string', [seanceRow(OWNED_ID, { invariantsJson: { entry_function: 42, input: 'a', output: 'b', invariants: [] } })]],
  ])('R3.11 %s gives SEANCE_REQUIRED before any quota call (Requirement 3)', async (_label, seances) => {
    const harness = buildVerifyHarness({ ...ready(), seances });
    expect((await run(harness)).code).toBe('SEANCE_REQUIRED');
    expect(harness.store.quotaCalls).toBe(0);
    expect(harness.sandbox.calls).toBe(0);
  });

  it('R4.5 disabled execution gives VERIFICATION_DISABLED before the quota step, with the reason as log detail (Requirement 4)', async () => {
    const harness = buildVerifyHarness({ ...ready(), execution: DISABLED });
    expect((await run(harness)).code).toBe('VERIFICATION_DISABLED');
    expect(harness.store.quotaCalls).toBe(0);
    expect(harness.logs).toEqual([expect.objectContaining({ event: 'verification_error', code: 'VERIFICATION_DISABLED', detail: 'flag_off' })]);
  });

  it('R9.1 every status and code produced in these examples is in the closed list (Requirement 9)', async () => {
    const results = [passed(), failed(), errored('SANDBOX_TIMEOUT'), denied('USER_CONCURRENCY_LIMIT'), errored('SANDBOX_UNAVAILABLE'), errored('INTERNAL_ERROR')];
    for (const result of results) {
      const checked = await run(buildVerifyHarness({ ...ready(), results: [result] }));
      if (checked.code !== null) expect(VERIFY_ERROR_CODES).toContain(checked.code);
    }
  });
});
