import type * as fc from 'fast-check';

/** Where the code to verify comes from. Only `sample` is executed (Requirement 3). */
export type Origin = 'sample' | 'user';

/** Every error code a Verification_Result can carry (Requirement 2, criterion 9). */
export type ErrorCode =
  | 'INVALID_OPTIONS'
  | 'UNSUPPORTED_ORIGIN'
  | 'LEGACY_LOAD_ERROR'
  | 'ENTRY_FUNCTION_NOT_FOUND'
  | 'MODERN_COMPILE_ERROR'
  | 'MODERN_LOAD_ERROR'
  | 'TEST_CODE_ERROR'
  | 'CALL_TIMEOUT'
  | 'TOTAL_TIMEOUT'
  | 'INTERNAL_ERROR';

interface CommonOptions {
  origin: Origin;
  legacyCode: string;
  modernCode: string;
  entryFunction: string;
  /** Integer from 100 to 1000. Default 1000. */
  numRuns?: number;
  /** 32-bit signed integer. Default `Date.now() | 0`. */
  seed?: number;
  /** Integer from 1 to 60000. Default 1000. */
  callTimeoutMs?: number;
  /** Integer from 1 to 600000. Default 60000. */
  totalTimeoutMs?: number;
}

/** Options of the programmatic mode: the caller supplies the input generator. */
export interface VerifyEquivalenceOptions extends CommonOptions {
  inputArbitrary: fc.Arbitrary<unknown>;
}

/** Options of the stored-test mode: the caller supplies a `pbt_test_code` string. */
export interface VerifyTestCodeOptions extends CommonOptions {
  testCode: string;
}

/** The smallest failing input found, with both rendered outcomes. */
export interface Counterexample {
  /** The shrunk input rendered with `fc.stringify`, at most 2000 characters. */
  input: string;
  /** At most 500 characters, or `"unavailable"`. */
  legacyOutcome: string;
  /** At most 500 characters, or `"unavailable"`. */
  modernOutcome: string;
  /** `true` when `fast-check` shrank the input at least once. */
  shrunk: boolean;
}

export interface PassedResult {
  status: 'PASSED';
  totalRuns: number;
  seed: number;
  executionTimeMs: number;
  evidence: string;
}

export interface FailedResult {
  status: 'FAILED';
  totalRuns: number;
  seed: number;
  executionTimeMs: number;
  counterexample: Counterexample;
  evidence: string;
}

export interface ErrorResult {
  status: 'ERROR';
  code: ErrorCode;
  message: string;
  executionTimeMs: number;
}

/** The value both entry points resolve to. JSON-serializable by construction. */
export type VerificationResult = PassedResult | FailedResult | ErrorResult;
