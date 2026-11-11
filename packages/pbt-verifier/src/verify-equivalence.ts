import * as fc from 'fast-check';
import type { NormalizedEquivalenceOptions } from './options.js';
import { executeProperty, type RunResult } from './run/execute.js';
import { prepareSides } from './run/prepare.js';
import type { RunState } from './run/run-state.js';

/**
 * Programmatic mode (Requirement 7): the property calls both functions with copies of each generated
 * input and passes if and only if the Outcomes are equivalent. The options are already validated; the
 * pipeline adds the guard, the timing, and the final result shape.
 */
export async function runEquivalence(
  options: NormalizedEquivalenceOptions,
  state: RunState,
): Promise<RunResult> {
  const sides = prepareSides(options, state);
  if (!sides.ok) return { status: 'ERROR', code: sides.code, message: sides.message };

  const property = fc.property(options.inputArbitrary, (input) => sides.assertEquivalent(input));
  return executeProperty(property, { ...options, state });
}
