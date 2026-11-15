// The verification state and the evidence text of a stored reincarnation (Requirement 6). Pure module: no framework
// imports, no process.env. Everything is computed from the stored columns, never from an API response.
import type { Reincarnation } from '@/lib/data/types';
import type { StatusTone } from '@/lib/ui/status';
import { formatDuration, formatRunCount } from './format';

export type VerificationState = 'VERIFIED' | 'FAILED' | 'NOT_RUN' | 'INCOMPLETE';

/** The words used for each state in the stage overview and in the text label of the evidence block. */
export const VERIFICATION_LABELS: Record<VerificationState, string> = {
  VERIFIED: 'Verified',
  FAILED: 'Failed',
  NOT_RUN: 'Not verified yet',
  INCOMPLETE: 'Incomplete',
};

export interface VerificationView {
  state: VerificationState;
  tone: StatusTone;
  /** The Evidence_Text for `VERIFIED`; the one-line statement of the state otherwise. */
  headline: string;
  /** Extra sentences, in display order. */
  details: string[];
  /** Set only when a valid run count is part of the text shown. */
  runCount: number | null;
}

export interface VerificationOptions {
  /** True when the Verify_Control is shown right below the evidence block. Only the `NOT_RUN` state reads it. */
  verifyAvailable?: boolean;
}

/** A run count is valid when it is a positive integer that is exact in a JavaScript number. */
export function isValidRunCount(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER;
}

function isValidDuration(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

export function verificationState(r: Pick<Reincarnation, 'pbtPassed' | 'totalRuns'>): VerificationState {
  if (r.pbtPassed === null) return 'NOT_RUN';
  if (r.pbtPassed === false) return 'FAILED';
  return isValidRunCount(r.totalRuns) ? 'VERIFIED' : 'INCOMPLETE';
}

export function buildVerificationView(
  r: Pick<Reincarnation, 'pbtPassed' | 'totalRuns' | 'executionTimeMs'>,
  options: VerificationOptions = {},
): VerificationView {
  if (r.pbtPassed === null) {
    return {
      state: 'NOT_RUN',
      tone: 'neutral',
      headline: 'Not verified yet.',
      details: options.verifyAvailable === true ? [] : ['No property-based test result is stored for this module.'],
      runCount: null,
    };
  }
  if (r.pbtPassed === false) {
    const runs = isValidRunCount(r.totalRuns) ? r.totalRuns : null;
    return {
      state: 'FAILED',
      tone: 'curse',
      headline: 'The modern function differed from the legacy function.',
      details: runs === null ? [] : [`The check stopped after ${formatRunCount(runs)} generated inputs.`],
      runCount: runs,
    };
  }
  if (!isValidRunCount(r.totalRuns)) {
    return {
      state: 'INCOMPLETE',
      tone: 'neutral',
      headline: 'A passing result is stored without a run count, so no evidence is shown.',
      details: [],
      runCount: null,
    };
  }
  const details = ['This is empirical evidence from randomly generated inputs. Other inputs were not checked.'];
  if (isValidDuration(r.executionTimeMs)) details.push(`Completed in ${formatDuration(r.executionTimeMs)}.`);
  return {
    state: 'VERIFIED',
    tone: 'verified',
    headline: `Verified behavioral equivalence across ${formatRunCount(r.totalRuns)} generated inputs.`,
    details,
    runCount: r.totalRuns,
  };
}