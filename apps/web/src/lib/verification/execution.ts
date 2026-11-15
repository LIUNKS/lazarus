import 'server-only';

// The Effective_Execution_Flag (Requirement 4 criterion 4): true only when the reviewed constant is true and the
// kill switch is not engaged. An invalid kill switch value counts as engaged.
import { readKillSwitch, type KillSwitchState } from '@/lib/env-server';
import { USER_EXECUTION_ENABLED } from './flags';

export type ExecutionDecision =
  | { enabled: true }
  | { enabled: false; reason: 'flag-off' | 'kill-switch' | 'kill-switch-invalid' };

export function decideExecution(flag: boolean, state: KillSwitchState): ExecutionDecision {
  if (!flag) return { enabled: false, reason: 'flag-off' };
  if (state === 'engaged') return { enabled: false, reason: 'kill-switch' };
  if (state === 'invalid') return { enabled: false, reason: 'kill-switch-invalid' };
  return { enabled: true };
}

export function effectiveExecution(): ExecutionDecision {
  return decideExecution(USER_EXECUTION_ENABLED, readKillSwitch());
}
