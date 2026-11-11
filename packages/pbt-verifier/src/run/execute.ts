import * as fc from 'fast-check';
import { safeStringify, truncate } from '../equivalence/outcome.js';
import { UncloneableInputError } from '../sandbox/cloner.js';
import { describeThrown } from '../sandbox/context.js';
import type { Counterexample, ErrorCode } from '../types.js';
import { EquivalenceError, SideThrow, type RunState } from './run-state.js';

export const MAX_INPUT_LENGTH = 2000;
const UNAVAILABLE = 'unavailable';

/**
 * The message `fast-check` 4.10.2 puts in `errorInstance` when a predicate returns `false`. The
 * design assumed `errorInstance` would be undefined in that case; the installed version reports an
 * Error with this text instead (see "Open Questions" in the design). A test pins this text.
 */
export const RETURNED_FALSE_MESSAGE = 'Property failed by returning false';

/** Result of the run engine. The pipeline adds the evidence text and `executionTimeMs`. */
export type RunResult =
  | { status: 'PASSED'; totalRuns: number; seed: number }
  | { status: 'FAILED'; totalRuns: number; seed: number; counterexample: Counterexample }
  | { status: 'ERROR'; code: ErrorCode; message: string };

export interface ExecuteOptions {
  numRuns: number;
  seed: number;
  callTimeoutMs: number;
  totalTimeoutMs: number;
  state: RunState;
}

function timeoutResult(options: ExecuteOptions): RunResult {
  const { fatal } = options.state;
  if (fatal?.code === 'CALL_TIMEOUT') {
    return {
      status: 'ERROR',
      code: 'CALL_TIMEOUT',
      message: `The ${fatal.side} function did not return within the call timeout of ${options.callTimeoutMs} ms.`,
    };
  }
  return {
    status: 'ERROR',
    code: 'TOTAL_TIMEOUT',
    message: `The verification did not finish within the total timeout of ${options.totalTimeoutMs} ms.`,
  };
}

function isReturnedFalse(error: unknown): boolean {
  return error instanceof Error && error.message === RETURNED_FALSE_MESSAGE;
}

function renderInput(args: unknown): string {
  const input = Array.isArray(args) && args.length === 1 ? (args[0] as unknown) : args;
  return truncate(safeStringify(input), MAX_INPUT_LENGTH);
}

function failedResult(details: fc.RunDetails<unknown>, options: ExecuteOptions): RunResult {
  const difference = options.state.lastDifference;
  return {
    status: 'FAILED',
    totalRuns: details.numRuns,
    seed: options.seed,
    counterexample: {
      input: renderInput(details.counterexample),
      legacyOutcome: difference?.legacy ?? UNAVAILABLE,
      modernOutcome: difference?.modern ?? UNAVAILABLE,
      shrunk: details.numShrinks > 0,
    },
  };
}

/**
 * Runs `fc.check` and maps the details to a result (design, "Classification").
 *
 * Only `numRuns` and `seed` are passed, so a successful run executes exactly `numRuns` Runs and no
 * `fast-check` option can skip or cap them (Requirement 7, criterion 13). A thrown error from
 * `fc.check` itself (for example a generator that throws) is left to the pipeline.
 */
export async function executeProperty(
  property: fc.IRawProperty<unknown>,
  options: ExecuteOptions,
): Promise<RunResult> {
  const details = await fc.check(property, { numRuns: options.numRuns, seed: options.seed });
  const { state } = options;

  // A timeout before any difference decides the result, whatever else `fast-check` reports.
  if (state.fatal !== null && !state.firstDifferenceSeen) return timeoutResult(options);

  if (!details.failed) {
    return { status: 'PASSED', totalRuns: details.numRuns, seed: options.seed };
  }

  const cause = details.errorInstance;
  if (details.interrupted || cause === null) {
    return {
      status: 'ERROR',
      code: 'TEST_CODE_ERROR',
      message:
        'The property could not generate enough valid inputs. Check the preconditions (fc.pre) of the test code.',
    };
  }
  if (cause instanceof UncloneableInputError) {
    return { status: 'ERROR', code: 'INVALID_OPTIONS', message: cause.message };
  }
  if (state.firstDifferenceSeen || cause instanceof EquivalenceError || isReturnedFalse(cause)) {
    return failedResult(details, options);
  }
  if (cause instanceof SideThrow) {
    return {
      status: 'ERROR',
      code: 'TEST_CODE_ERROR',
      message: `The test code called the ${cause.side} function directly and it threw ${cause.thrownName}. Compare outcomes through assertEquivalent so that a thrown error is part of the comparison.`,
    };
  }
  return {
    status: 'ERROR',
    code: 'TEST_CODE_ERROR',
    message: `The test code threw an unexpected error: ${describeThrown(cause)}`,
  };
}
