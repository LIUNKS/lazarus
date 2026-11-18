import fc from 'fast-check';
import { describe, it } from 'vitest';
import {
  bodyCaseArb,
  buildVerifyHarness,
  checkVerifyResponse,
  corpseIdOf,
  corpseKindArb,
  executionArb,
  MEMBER_ID,
  OWNED_ID,
  quotaScriptFor,
  quotaStepArb,
  requestForCase,
  seanceStateArb,
  storeState,
  verdictArb,
  type BodyCase,
} from '@/lib/testing/verification-arbitraries';
import type { ExecutionDecision } from './execution';
import { handleVerify } from './verify';

async function respond(options: { memberId: string | null; body: BodyCase; corpseId: string; execution: ExecutionDecision; state: ReturnType<typeof storeState>; quota: Parameters<typeof quotaScriptFor>[0] }) {
  const harness = buildVerifyHarness({ memberId: options.memberId, ...options.state, quota: [quotaScriptFor(options.quota)], execution: options.execution });
  const checked = await checkVerifyResponse(await handleVerify(requestForCase(options.body, options.corpseId), harness.deps));
  const free =
    harness.sandbox.calls === 0 &&
    harness.store.quotaCalls === 0 &&
    harness.counters.executionReads === 0 &&
    harness.store.writes.length === 0;
  return { checked, free };
}

describe('free paths', () => {
  it('R3.6 a Visitor request costs nothing and does not depend on the switches, whatever the body (Requirement 3)', async () => {
    // Feature: 08-live-verification-api, Property 2: Free paths
    await fc.assert(
      fc.asyncProperty(
        bodyCaseArb,
        corpseKindArb,
        fc.boolean(),
        verdictArb,
        seanceStateArb,
        quotaStepArb,
        executionArb,
        executionArb,
        async (body, corpse, reincarnation, verdict, seance, quota, first, second) => {
          const state = () => storeState({ reincarnation, verdict, seance });
          const a = await respond({ memberId: null, body, corpseId: corpseIdOf(corpse), execution: first, state: state(), quota });
          const b = await respond({ memberId: null, body, corpseId: corpseIdOf(corpse), execution: second, state: state(), quota });
          return a.free && b.free && a.checked.text === b.checked.text && a.checked.status === b.checked.status;
        },
      ),
      { numRuns: 150 },
    );
  });

  it('R3.12 R13.1 a precomputed answer (Visitor) or a stored answer (owner) costs nothing and is the same for every switch value (Requirement 3)', async () => {
    // Feature: 08-live-verification-api, Supporting check: Precomputed and stored answers are free
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('precomputed', 'stored'),
        fc.boolean(),
        seanceStateArb,
        quotaStepArb,
        executionArb,
        executionArb,
        async (path, passed, seance, quota, first, second) => {
          const corpseId = path === 'precomputed' ? corpseIdOf('sample') : OWNED_ID;
          // A Member who asks for a sample gets a live run (Requirement 13), so only a Visitor gets `precomputed`.
          const member = path === 'stored' ? MEMBER_ID : null;
          const state = () => storeState({ reincarnation: true, verdict: passed, seance });
          const a = await respond({ memberId: member, body: 'valid', corpseId, execution: first, state: state(), quota });
          const b = await respond({ memberId: member, body: 'valid', corpseId, execution: second, state: state(), quota });
          return a.free && b.free && a.checked.status === 200 && a.checked.body['source'] === path && a.checked.text === b.checked.text;
        },
      ),
      { numRuns: 150 },
    );
  });
});
