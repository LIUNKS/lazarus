import 'server-only';

// The Live_Flags of 10-onboarding-invites: the same server decisions that gate the "Verify live" control, so the
// invitation lists live verification only while the server actually runs it.
import type { LiveFlags } from '@/lib/onboarding/copy';
import { effectiveExecution, effectiveSampleExecution } from '@/lib/verification/execution';

export function liveFlags(): LiveFlags {
  return { ownCode: effectiveExecution().enabled, samples: effectiveSampleExecution().enabled };
}
