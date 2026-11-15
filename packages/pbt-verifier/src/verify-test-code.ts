import * as fc from 'fast-check';
import type { NormalizedTestCodeOptions } from './options.js';
import { executeProperty, type RunResult } from './run/execute.js';
import { prepareSides } from './run/prepare.js';
import type { RunState } from './run/run-state.js';
import { createSandbox, describeThrown } from './sandbox/context.js';

/** The parameters of the Test_Code function, in the order the contract fixes (Requirement 8, criterion 2). */
const TEST_CODE_PARAMETERS = ['fc', 'legacyFn', 'modernFn', 'assertEquivalent', 'numRuns'];

function testCodeError(message: string): RunResult {
  return { status: 'ERROR', code: 'TEST_CODE_ERROR', message };
}

/** A `fast-check` property, recognized by its methods (the Test_Code builds it with the host `fc`). */
function isProperty(value: unknown): value is fc.IRawProperty<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.generate === 'function' &&
    typeof candidate.run === 'function' &&
    typeof candidate.isAsync === 'function'
  );
}

/**
 * Stored-test mode (Requirement 8). The Test_Code is compiled as the body of a function in its own
 * fresh context, called once to obtain a property, and that property is run by the Verifier with the
 * validated `numRuns` and `seed`. The Test_Code controls neither of them.
 */
export async function runTestCode(
  options: NormalizedTestCodeOptions,
  state: RunState,
): Promise<RunResult> {
  const sides = prepareSides(options, state);
  if (!sides.ok) return { status: 'ERROR', code: sides.code, message: sides.message };

  const testSandbox = createSandbox();
  let build: (...args: unknown[]) => unknown;
  try {
    build = testSandbox.compile(options.testCode, TEST_CODE_PARAMETERS, 'test-code.js');
  } catch (error) {
    return testCodeError(`The test code does not compile: ${describeThrown(error)}`);
  }

  let property: unknown;
  try {
    property = build(
      fc,
      (input: unknown) => sides.legacy.call(input),
      (input: unknown) => sides.modern.call(input),
      sides.assertEquivalent,
      options.numRuns,
    );
  } catch (error) {
    return testCodeError(`The test code threw while building the property: ${describeThrown(error)}`);
  }

  if (!isProperty(property)) {
    return testCodeError(
      'The test code did not return a fast-check property. End it with "return fc.property(...)".',
    );
  }
  return executeProperty(property, { ...options, state });
}
