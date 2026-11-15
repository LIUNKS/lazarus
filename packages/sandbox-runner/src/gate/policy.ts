import type { DenialReason, GateConfig } from '../types.js';

/** User execution is off and anonymous sample runs are off until an operator decides otherwise. */
export const DEFAULT_GATE_CONFIG: Readonly<GateConfig> = Object.freeze({
  userExecutionEnabled: false,
  allowAnonymousSampleRuns: false,
  perUserConcurrency: 1,
  globalConcurrency: 4,
});

export type GateDecision =
  | { allow: true; executor: 'in-process' }
  | { allow: true; executor: 'sandbox'; userId: string }
  | { allow: false; reason: DenialReason };

const deny = (reason: DenialReason): GateDecision => ({ allow: false, reason });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** `null` for a malformed caller, otherwise the user id of a member or `undefined` for anonymous. */
function readCaller(value: unknown): { userId: string | undefined } | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'anonymous') return { userId: undefined };
  if (value.kind === 'member' && typeof value.userId === 'string' && value.userId !== '') {
    return { userId: value.userId };
  }
  return null;
}

/**
 * Decides whether a corpus may run live (Requirement 3, criteria 1 to 8). Pure: it reads only its
 * arguments, never the environment. Concurrency is checked afterwards by the gate.
 */
export function decideLiveExecution(request: unknown, config: GateConfig): GateDecision {
  if (!isRecord(request)) return deny('INVALID_REQUEST');
  const { origin, corpusOwnerId } = request;
  const caller = readCaller(request.caller);
  if (caller === null) return deny('INVALID_REQUEST');
  if (origin !== 'sample' && origin !== 'user') return deny('INVALID_REQUEST');
  if (corpusOwnerId !== null && typeof corpusOwnerId !== 'string') return deny('INVALID_REQUEST');

  if (origin === 'sample') {
    if (caller.userId !== undefined || config.allowAnonymousSampleRuns === true) {
      return { allow: true, executor: 'in-process' };
    }
    return deny('ANONYMOUS_NOT_ALLOWED');
  }

  if (caller.userId === undefined) return deny('AUTH_REQUIRED');
  if (config.userExecutionEnabled !== true) return deny('USER_EXECUTION_DISABLED');
  if (corpusOwnerId === null || corpusOwnerId !== caller.userId) return deny('NOT_OWNER');
  return { allow: true, executor: 'sandbox', userId: caller.userId };
}
