import fc from 'fast-check';
import { describe, it } from 'vitest';
import {
  bodyCaseArb,
  buildVerifyHarness,
  callerArb,
  checkVerifyResponse,
  corpseIdOf,
  corpseKindArb,
  DISABLED,
  ENABLED,
  MEMBER_ID,
  PRECHECK_CODE,
  quotaScriptFor,
  quotaStepArb,
  requestForCase,
  seanceStateArb,
  storeState,
  verdictArb,
  type BodyCase,
  type CallerKind,
  type CorpseKind,
  type QuotaStep,
  type SeanceState,
} from '@/lib/testing/verification-arbitraries';
import type { VerifyErrorCode } from './errors';
import { handleVerify } from './verify';

interface Scenario {
  body: BodyCase;
  caller: CallerKind;
  corpse: CorpseKind;
  reincarnation: boolean;
  verdict: boolean | null;
  seance: SeanceState;
  enabled: boolean;
  quota: QuotaStep;
}

type Expected = { kind: 'error'; code: VerifyErrorCode; quotaCalled: boolean } | { kind: 'ok'; source: 'precomputed' | 'stored' | 'executed' };

// The order of Requirement 3 criterion 8, written independently of the handler.
function expected(s: Scenario): Expected {
  const precheck = PRECHECK_CODE[s.body];
  if (precheck !== null) return { kind: 'error', code: precheck, quotaCalled: false };
  if (s.corpse === 'sample') return { kind: 'ok', source: 'precomputed' };
  if (s.caller === 'visitor') return { kind: 'error', code: 'AUTH_REQUIRED', quotaCalled: false };
  if (s.corpse !== 'owned') return { kind: 'error', code: 'NOT_FOUND', quotaCalled: false };
  if (!s.reincarnation) return { kind: 'error', code: 'REINCARNATION_REQUIRED', quotaCalled: false };
  if (s.verdict !== null) return { kind: 'ok', source: 'stored' };
  if (!s.enabled) return { kind: 'error', code: 'VERIFICATION_DISABLED', quotaCalled: false };
  if (s.seance !== 'valid') return { kind: 'error', code: 'SEANCE_REQUIRED', quotaCalled: false };
  if (s.quota === 'deny-user' || s.quota === 'deny-global') return { kind: 'error', code: 'RATE_LIMITED', quotaCalled: true };
  if (s.quota === 'error') return { kind: 'error', code: 'QUOTA_UNAVAILABLE', quotaCalled: true };
  return { kind: 'ok', source: 'executed' };
}

const scenario: fc.Arbitrary<Scenario> = fc.record({
  body: bodyCaseArb,
  caller: callerArb,
  corpse: corpseKindArb,
  reincarnation: fc.boolean(),
  verdict: verdictArb,
  seance: seanceStateArb,
  enabled: fc.boolean(),
  quota: quotaStepArb,
});

describe('verification gating', () => {
  it('R3.8 calls the sandbox if and only if every guard passed, after exactly one quota call (Requirement 3)', async () => {
    // Feature: 08-live-verification-api, Property 1: Execution gating and call budget
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const harness = buildVerifyHarness({
          memberId: s.caller === 'member' ? MEMBER_ID : null,
          ...storeState({ reincarnation: s.reincarnation, verdict: s.verdict, seance: s.seance }),
          quota: [quotaScriptFor(s.quota)],
          execution: s.enabled ? ENABLED : DISABLED,
        });
        const checked = await checkVerifyResponse(await handleVerify(requestForCase(s.body, corpseIdOf(s.corpse)), harness.deps));
        const want = expected(s);
        const ranSandbox = want.kind === 'ok' && want.source === 'executed';
        const quotaCalled = ranSandbox || (want.kind === 'error' && want.quotaCalled);

        if (want.kind === 'ok') {
          if (checked.status !== 200 || checked.body['source'] !== want.source) return false;
        } else if (checked.code !== want.code) {
          return false;
        }
        const quotaIndex = harness.store.calls.indexOf('reserveVerificationRun');
        return (
          harness.sandbox.calls === (ranSandbox ? 1 : 0) &&
          harness.store.quotaCalls === (quotaCalled ? 1 : 0) &&
          // The quota call came before the sandbox run.
          (!ranSandbox || (quotaIndex >= 0 && quotaIndex < (harness.storeCallsAtRun[0] ?? -1))) &&
          // A request that fails before the quota step writes nothing.
          (quotaCalled || harness.store.writes.length === 0)
        );
      }),
      { numRuns: 150 },
    );
  });
});
