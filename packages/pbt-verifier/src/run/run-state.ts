/** Why a verification had to stop before it could decide (Requirement 7, criteria 9 and 10). */
export type Fatal =
  | { code: 'CALL_TIMEOUT'; side: 'legacy' | 'modern' }
  | { code: 'TOTAL_TIMEOUT' };

/** The two Outcomes of the last non-equivalence, already rendered to at most 500 characters each. */
export interface RenderedDifference {
  legacy: string;
  modern: string;
}

/** Facts about one verification. A new object is created for every call, so nothing is shared. */
export interface RunState {
  /** `performance.now()` value after which no new call may start. */
  readonly deadline: number;
  /** Set by the first timeout. Once set, no function is called again. */
  fatal: Fatal | null;
  /** `true` once `assertEquivalent` has seen two Outcomes that are not equivalent. */
  firstDifferenceSeen: boolean;
  /** Overwritten on every non-equivalence. While shrinking, the last write belongs to the final counterexample. */
  lastDifference: RenderedDifference | null;
}

export function createRunState(startedAt: number, totalTimeoutMs: number): RunState {
  return {
    deadline: startedAt + totalTimeoutMs,
    fatal: null,
    firstDifferenceSeen: false,
    lastDifference: null,
  };
}

/**
 * Thrown inside a side wrapper when the verification must stop (a timeout happened or the budget is
 * spent). `assertEquivalent` turns it into a passing run when a difference was already found, so
 * `fast-check` ends its shrinking quickly (Requirement 7, criterion 11).
 */
export class StopSignal extends Error {
  constructor() {
    super('The verification was stopped.');
    this.name = 'StopSignal';
  }
}

/**
 * Thrown by the Verifier's own `assertEquivalent` when the Outcomes differ. The message states both
 * Outcomes (Requirement 8, criterion 4); the rendered strings are also kept as fields.
 */
export class EquivalenceError extends Error {
  readonly legacyOutcome: string;
  readonly modernOutcome: string;

  constructor(legacyOutcome: string, modernOutcome: string) {
    super(`Behavioral difference. Legacy: ${legacyOutcome}. Modern: ${modernOutcome}.`);
    this.name = 'EquivalenceError';
    this.legacyOutcome = legacyOutcome;
    this.modernOutcome = modernOutcome;
  }
}

/**
 * Thrown to Test_Code that calls `legacyFn` or `modernFn` directly when the function throws. It carries
 * the thrown `name` and never the original value or its stack.
 */
export class SideThrow extends Error {
  readonly side: 'legacy' | 'modern';
  readonly thrownName: string;

  constructor(side: 'legacy' | 'modern', thrownName: string) {
    super(`The ${side} function threw ${thrownName}.`);
    this.name = 'SideThrow';
    this.side = side;
    this.thrownName = thrownName;
  }
}
