import fc from 'fast-check';
import { afterEach, describe, it, vi } from 'vitest';
import { makeCorpse, reincarnationRow, sampleCorpse, seanceRow } from '@/lib/testing/harness';
import { errored, passed } from '@/lib/testing/mock-sandbox';
import {
  bodyCaseArb,
  buildVerifyHarness,
  checkVerifyResponse,
  corpseIdOf,
  corpseKindArb,
  MEMBER_ID,
  OWNED_ID,
  quotaScriptFor,
  quotaStepArb,
  requestForCase,
  SAMPLE_ID,
} from '@/lib/testing/verification-arbitraries';
import { effectiveExecution } from './execution';
import { handleVerify } from './verify';

afterEach(() => {
  vi.unstubAllEnvs();
});

const SENTINELS = {
  sandbox: 'sentinel-sandbox-message-9c41',
  database: 'sentinel-database-error-4e19',
  legacy: 'sentinelLegacyCode5a2b',
  modern: 'sentinelModernCode6c3d',
  test: 'sentinelTestCode7d4e',
  killSwitch: 'sentinel-kill-switch-8e5f',
};

type Failure = 'none' | 'sandbox-error' | 'record-error' | 'seance-error' | 'disabled';

describe('envelope and non-leakage on every path', () => {
  it('R9.5 writes one failure line per error response and leaks no sentinel into a body or a log line (Requirement 9)', async () => {
    // Feature: 08-live-verification-api, Property 9: Envelope and non-leakage
    await fc.assert(
      fc.asyncProperty(
        bodyCaseArb,
        corpseKindArb,
        fc.constantFrom<string | null>(MEMBER_ID, null),
        quotaStepArb,
        fc.constantFrom<Failure>('none', 'sandbox-error', 'record-error', 'seance-error', 'disabled'),
        async (body, corpse, memberId, quota, failure) => {
          // The kill switch holds a sentinel. Each run stubs it once (see the guard note in env-server.test.ts).
          vi.unstubAllEnvs();
          vi.stubEnv('LAZARUS_SANDBOX_KILL_SWITCH', failure === 'disabled' ? SENTINELS.killSwitch : '0');
          const harness = buildVerifyHarness({
            memberId,
            corpses: [makeCorpse({ originalCode: `function calc(a) { return '${SENTINELS.legacy}'; }` }), sampleCorpse()],
            reincarnations: [
              reincarnationRow(OWNED_ID, { modernCode: `export const x = '${SENTINELS.modern}';`, pbtTestCode: `// ${SENTINELS.test}` }),
              reincarnationRow(SAMPLE_ID, { pbtPassed: true, totalRuns: 1_000, executionTimeMs: 5 }),
            ],
            seances: [seanceRow(OWNED_ID)],
            quota: [quotaScriptFor(quota)],
            results: [
              failure === 'sandbox-error'
                ? errored('SANDBOX_CRASH', { message: SENTINELS.sandbox })
                : failure === 'record-error' || failure === 'none'
                  ? passed()
                  : errored('PASSED_LOOKALIKE', { message: SENTINELS.sandbox }),
            ],
            // The real decision function, so an invalid kill switch value goes through the production path.
            execution: () => (failure === 'disabled' ? effectiveExecution() : { enabled: true }),
          });
          // A database failure arrives as an error whose text is the database message. Only a short code may be logged.
          if (failure === 'record-error') harness.store.failOn('recordVerification', new Error(SENTINELS.database));
          if (failure === 'seance-error') harness.store.failOn('getSeance', new Error(SENTINELS.database));

          const checked = await checkVerifyResponse(await handleVerify(requestForCase(body, corpseIdOf(corpse)), harness.deps), Object.values(SENTINELS));
          const failureLines = harness.logs.filter((line) => line.event === 'verification_error');
          const logText = JSON.stringify(harness.logs);
          const leaks = Object.values(SENTINELS).some((sentinel) => logText.includes(sentinel));
          if (checked.status === 200) return failureLines.length === 0 && !leaks;
          const line = failureLines[0];
          return (
            failureLines.length === 1 &&
            line !== undefined &&
            line.route === 'verify' &&
            line.code === checked.code &&
            Number.isInteger(line.elapsedMs) &&
            line.elapsedMs >= 0 &&
            (line.corpseId === null || line.corpseId === corpseIdOf(corpse)) &&
            !leaks
          );
        },
      ),
      { numRuns: 150 },
    );
  });
});
