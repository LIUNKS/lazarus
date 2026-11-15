import 'server-only';

// The Gate of this process (Requirement 6 criterion 5). It is created once, with the Effective_Execution_Flag as it
// reads at that moment. The route still checks the flag on every request before the quota step, so engaging the
// kill switch stops runs at once; the Gate is a second layer.
// The concurrency counters live in the memory of this process: the limits apply per server process, not across
// instances, and a development hot reload resets them. The route never releases a Lease: verifyLive does.
// The Gate is a promise because the Sandbox_Runner is loaded at run time (see sandbox.ts).
import { effectiveExecution } from './execution';
import { VERIFICATION_LIMITS } from './limits';
import { createGate, type LiveExecutionGate } from './sandbox';

let gate: Promise<LiveExecutionGate> | null = null;

export function getVerificationGate(): Promise<LiveExecutionGate> {
  gate ??= createGate({
    userExecutionEnabled: effectiveExecution().enabled,
    allowAnonymousSampleRuns: false,
    perUserConcurrency: VERIFICATION_LIMITS.perUserConcurrency,
    globalConcurrency: VERIFICATION_LIMITS.globalConcurrency,
  });
  return gate;
}
