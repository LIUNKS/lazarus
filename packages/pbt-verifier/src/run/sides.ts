import { equivalentOutcomes, renderOutcome, type Outcome } from '../equivalence/outcome.js';
import type { Sandbox, SandboxFunction } from '../sandbox/context.js';
import {
  EquivalenceError,
  SideThrow,
  StopSignal,
  type RunState,
} from './run-state.js';

export type SideName = 'legacy' | 'modern';

/** One loaded Entry_Function wrapped with the budget checks, the input copy, and the call timeout. */
export interface Side {
  /** Runs the function and returns its Outcome. Never throws for ordinary behavior of the function. */
  outcome(input: unknown): Outcome;
  /** For Test_Code: returns the value, or throws `SideThrow` when the function threw. */
  call(input: unknown): unknown;
}

/**
 * Stops the run when a timeout already happened or the total budget is spent. A function is never
 * called after that (Requirement 7, criteria 9 and 10).
 */
function checkBudget(state: RunState): void {
  if (state.fatal === null && performance.now() > state.deadline) {
    state.fatal = { code: 'TOTAL_TIMEOUT' };
  }
  if (state.fatal !== null) throw new StopSignal();
}

/**
 * Builds the wrapper of one side. Each call: check the budget, copy the input into the function's own
 * realm, call it with `callTimeoutMs`, and read the Outcome. Inputs that cannot be copied raise
 * `UncloneableInputError`, which the run engine reports as `INVALID_OPTIONS`.
 */
export function makeSide(
  sandbox: Sandbox,
  fn: SandboxFunction,
  side: SideName,
  state: RunState,
  callTimeoutMs: number,
): Side {
  const outcome = (input: unknown): Outcome => {
    checkBudget(state);
    const copy = sandbox.cloneInto(input);
    const result = sandbox.invoke(fn, copy, callTimeoutMs);
    if (result.kind === 'timeout') {
      state.fatal = { code: 'CALL_TIMEOUT', side };
      throw new StopSignal();
    }
    return result.kind === 'returned'
      ? { kind: 'returned', value: result.value }
      : { kind: 'threw', name: result.name };
  };

  return {
    outcome,
    call(input) {
      const result = outcome(input);
      if (result.kind === 'threw') throw new SideThrow(side, result.name);
      return result.value;
    },
  };
}

/**
 * The Verifier's own `assertEquivalent(input)` (Requirement 8, criterion 4). It returns `undefined`
 * when the Outcomes are equivalent and throws `EquivalenceError` when they are not, after recording
 * the rendered Outcomes in the run state.
 *
 * When the run must stop and a difference was already found, it returns `undefined` so that the
 * shrink candidate counts as passing and `fast-check` stops shrinking (Requirement 7, criterion 11).
 * When no difference was found, the `StopSignal` is rethrown and the run ends as a timeout error.
 */
export function createAssertEquivalent(
  legacy: Side,
  modern: Side,
  state: RunState,
): (input: unknown) => undefined {
  return (input) => {
    let legacyOutcome: Outcome;
    let modernOutcome: Outcome;
    try {
      legacyOutcome = legacy.outcome(input);
      modernOutcome = modern.outcome(input);
    } catch (error) {
      if (error instanceof StopSignal && state.firstDifferenceSeen) return undefined;
      throw error;
    }
    if (equivalentOutcomes(legacyOutcome, modernOutcome)) return undefined;

    const difference = {
      legacy: renderOutcome(legacyOutcome),
      modern: renderOutcome(modernOutcome),
    };
    state.firstDifferenceSeen = true;
    state.lastDifference = difference;
    throw new EquivalenceError(difference.legacy, difference.modern);
  };
}
