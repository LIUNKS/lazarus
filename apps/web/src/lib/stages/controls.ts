// Who may do what on the corpse page, and the state words of the stage overview (Requirements 1, 7, and 8).
// Pure module: no framework imports, no process.env.
import { pluralize } from '@/lib/ui/format';
import { VERIFICATION_LABELS, type VerificationState } from './verification';

export type StageAccess = 'visitor' | 'member-viewer' | 'owner';

/**
 * - `owner`: a Member looking at a corpse the Member owns (never a sample).
 * - `member-viewer`: a Member looking at any other corpse (in practice a sample).
 * - `visitor`: no session.
 * The result comes from verified claims and the corpse row on the server, never from a client value.
 */
export function resolveAccess(
  viewer: { member: { id: string } } | null,
  corpse: { isSample: boolean; userId: string | null },
): StageAccess {
  if (viewer === null) return 'visitor';
  return !corpse.isSample && corpse.userId === viewer.member.id ? 'owner' : 'member-viewer';
}

/** What is stored for the corpse. The verification state is null when no reincarnation exists. */
export interface StageFacts {
  curseCount: number;
  hasSeance: boolean;
  seanceApproved: boolean;
  hasReincarnation: boolean;
  verificationState: VerificationState | null;
  /** True for a Sample_Corpse. Comes from the corpse row read on the server. */
  isSample: boolean;
  /**
   * True when the server runs live verification of this corpse. It comes from the server-side execution decision, never
   * from a client value: for an owned corpse the reviewed flag and the kill switch, for a sample the kill switch only.
   */
  liveVerificationEnabled: boolean;
}

export type ControlState = { available: true } | { available: false; reason: string | null };

export interface StageControls {
  scan: ControlState;
  seance: ControlState;
  approve: ControlState;
  reincarnate: ControlState;
  verify: ControlState;
}

const UNAVAILABLE: ControlState = { available: false, reason: null };
const AVAILABLE: ControlState = { available: true };

/** The text of the "Verify live" control (Requirement 18 criteria 3 and 6). It states no limit value and no run count. */
export const VERIFY_LABEL = 'Verify live';
export const VERIFY_HELP_TEXT =
  'Runs the legacy and the modern function in an isolated environment on generated inputs. This can take up to a minute and counts toward a separate verification limit.';
export const VERIFY_PENDING_TEXT = 'Running the check. This can take up to a minute.';
/** The help text of "Verify live" on a sample: the run is not stored, and the code is the reviewed sample code. */
export const VERIFY_SAMPLE_HELP_TEXT =
  'Runs the legacy and the modern function of this sample again on newly generated inputs. The result is shown here and is not stored. This can take up to a minute and counts toward a separate verification limit.';

export const REASON_RUN_SEANCE_FIRST = 'Run the séance first.';
export const REASON_APPROVE_FIRST = 'Approve the séance spec to enable reincarnation.';
export const REASON_VERIFY_OFF = 'Live verification is not available on this server.';

/**
 * The actions the page offers for an access level and the stored state.
 *
 * - A `visitor` gets no action at all. A `member-viewer` gets one action only: "Verify live" on a sample that has a
 *   stored reincarnation, while the server runs sample verification (08-live-verification-api Requirement 13). That run
 *   is never stored, so it is offered whatever the stored verification state is.
 * - An owner can always scan. The séance is offered only while none is stored, and the approval only for an unapproved one.
 * - The reincarnation is offered only for an approved séance without a reincarnation. That approval condition is a
 *   UI-level restriction only: the Reincarnate_Route does not check `approved_at` (Requirement 12 criterion 10 of
 *   05-llm-pipeline-api), so a direct API client can skip it. This is intended, and no backend check is planned.
 * - "Verify live" is offered only for a stored reincarnation in the state `NOT_RUN`, and only while the server runs live
 *   verification (`liveVerificationEnabled`). While it is off, the control is not offered and the owner gets a reason
 *   instead of a button that can only answer "switched off". The other states are final results, and
 *   08-live-verification-api offers no re-run for them.
 */
export function stageControls(access: StageAccess, facts: StageFacts): StageControls {
  if (access !== 'owner') {
    const sampleRun = access === 'member-viewer' && facts.isSample && facts.hasReincarnation && facts.liveVerificationEnabled;
    return { scan: UNAVAILABLE, seance: UNAVAILABLE, approve: UNAVAILABLE, reincarnate: UNAVAILABLE, verify: sampleRun ? AVAILABLE : UNAVAILABLE };
  }

  let reincarnate: ControlState;
  if (facts.hasReincarnation) reincarnate = UNAVAILABLE;
  else if (!facts.hasSeance) reincarnate = { available: false, reason: REASON_RUN_SEANCE_FIRST };
  else if (!facts.seanceApproved) reincarnate = { available: false, reason: REASON_APPROVE_FIRST };
  else reincarnate = AVAILABLE;

  let verify: ControlState = UNAVAILABLE;
  if (facts.hasReincarnation && facts.verificationState === 'NOT_RUN') {
    verify = facts.liveVerificationEnabled ? AVAILABLE : { available: false, reason: REASON_VERIFY_OFF };
  }

  return {
    scan: AVAILABLE,
    seance: facts.hasSeance ? UNAVAILABLE : AVAILABLE,
    approve: facts.hasSeance && !facts.seanceApproved ? AVAILABLE : UNAVAILABLE,
    reincarnate,
    verify,
  };
}

export interface StageSummary {
  id: 'hex-scanner' | 'seance-chamber' | 'laboratory';
  name: string;
  state: string;
}

/** The three overview entries with their state in words, computed from the stored data only. */
export function summarizeStages(facts: StageFacts): StageSummary[] {
  const scanner = facts.curseCount === 0 ? 'No curses stored' : `${pluralize(facts.curseCount, 'curse')} stored`;
  const seance = !facts.hasSeance ? 'Not started' : facts.seanceApproved ? 'Approved' : 'Awaiting approval';
  const laboratory = facts.verificationState === null ? 'Not started' : VERIFICATION_LABELS[facts.verificationState];
  return [
    { id: 'hex-scanner', name: 'Hex Scanner', state: scanner },
    { id: 'seance-chamber', name: 'Séance Chamber', state: seance },
    { id: 'laboratory', name: 'Laboratory', state: laboratory },
  ];
}
