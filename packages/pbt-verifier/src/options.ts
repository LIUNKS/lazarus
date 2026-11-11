import type * as fc from 'fast-check';
import type { ErrorCode, Origin } from './types.js';

/** Defaults and ranges of Requirement 7, criteria 2 to 5. */
export const DEFAULT_NUM_RUNS = 1000;
export const NUM_RUNS_RANGE = { min: 100, max: 1000 } as const;
export const DEFAULT_CALL_TIMEOUT_MS = 1000;
export const CALL_TIMEOUT_RANGE = { min: 1, max: 60_000 } as const;
export const DEFAULT_TOTAL_TIMEOUT_MS = 60_000;
export const TOTAL_TIMEOUT_RANGE = { min: 1, max: 600_000 } as const;
const SEED_RANGE = { min: -2_147_483_648, max: 2_147_483_647 } as const;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Reserved words that cannot name a function binding in ES2022 strict-mode code. The entry function
 * is declared by the legacy script and exported by the modern module, so both sides must accept it.
 */
const RESERVED_WORDS: ReadonlySet<string> = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
  'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if',
  'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package',
  'private', 'protected', 'public', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true',
  'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
]);

/** Options after validation: every optional field has a value. */
export interface NormalizedCommonOptions {
  origin: 'sample';
  legacyCode: string;
  modernCode: string;
  entryFunction: string;
  numRuns: number;
  seed: number;
  callTimeoutMs: number;
  totalTimeoutMs: number;
}

export interface NormalizedEquivalenceOptions extends NormalizedCommonOptions {
  inputArbitrary: fc.Arbitrary<unknown>;
}

export interface NormalizedTestCodeOptions extends NormalizedCommonOptions {
  testCode: string;
}

export interface OptionsFailure {
  ok: false;
  code: Extract<ErrorCode, 'INVALID_OPTIONS' | 'UNSUPPORTED_ORIGIN'>;
  message: string;
}

export type OptionsResult<T> = { ok: true; value: T } | OptionsFailure;

function invalid(message: string): OptionsFailure {
  return { ok: false, code: 'INVALID_OPTIONS', message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isOrigin(value: unknown): value is Origin {
  return value === 'sample' || value === 'user';
}

function isIntegerInRange(value: unknown, range: { min: number; max: number }): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= range.min &&
    value <= range.max
  );
}

/**
 * Step 1 and 2 of the guard (Requirement 3, criteria 1 to 3). Runs before any other field is read, so
 * no validation error of another field can pre-empt `UNSUPPORTED_ORIGIN`.
 */
export function checkOrigin(raw: unknown): OptionsFailure | null {
  if (!isRecord(raw) || !isOrigin(raw.origin)) {
    return invalid('The option "origin" is required and must be either "sample" or "user".');
  }
  if (raw.origin === 'user') {
    return {
      ok: false,
      code: 'UNSUPPORTED_ORIGIN',
      message:
        'Only code with origin "sample" can be verified in this process. User-imported code needs the isolated runner.',
    };
  }
  return null;
}

/** Validates the fields shared by both entry points. The caller has already run `checkOrigin`. */
function normalizeCommon(raw: Record<string, unknown>): OptionsResult<NormalizedCommonOptions> {
  const { legacyCode, modernCode, entryFunction } = raw;
  if (typeof legacyCode !== 'string') return invalid('The option "legacyCode" must be a string.');
  if (typeof modernCode !== 'string') return invalid('The option "modernCode" must be a string.');
  if (typeof entryFunction !== 'string' || !IDENTIFIER.test(entryFunction)) {
    return invalid('The option "entryFunction" must be a valid ECMAScript identifier.');
  }
  if (RESERVED_WORDS.has(entryFunction)) {
    return invalid(`The option "entryFunction" must not be a reserved word ("${entryFunction}").`);
  }

  const numRuns = raw.numRuns === undefined ? DEFAULT_NUM_RUNS : raw.numRuns;
  if (!isIntegerInRange(numRuns, NUM_RUNS_RANGE)) {
    return invalid(
      `The option "numRuns" must be an integer from ${NUM_RUNS_RANGE.min} to ${NUM_RUNS_RANGE.max}.`,
    );
  }

  const seed = raw.seed === undefined ? Date.now() | 0 : raw.seed;
  if (!isIntegerInRange(seed, SEED_RANGE)) {
    return invalid('The option "seed" must be a 32-bit signed integer.');
  }

  const callTimeoutMs = raw.callTimeoutMs === undefined ? DEFAULT_CALL_TIMEOUT_MS : raw.callTimeoutMs;
  if (!isIntegerInRange(callTimeoutMs, CALL_TIMEOUT_RANGE)) {
    return invalid(
      `The option "callTimeoutMs" must be an integer from ${CALL_TIMEOUT_RANGE.min} to ${CALL_TIMEOUT_RANGE.max}.`,
    );
  }

  const totalTimeoutMs =
    raw.totalTimeoutMs === undefined ? DEFAULT_TOTAL_TIMEOUT_MS : raw.totalTimeoutMs;
  if (!isIntegerInRange(totalTimeoutMs, TOTAL_TIMEOUT_RANGE)) {
    return invalid(
      `The option "totalTimeoutMs" must be an integer from ${TOTAL_TIMEOUT_RANGE.min} to ${TOTAL_TIMEOUT_RANGE.max}.`,
    );
  }

  return {
    ok: true,
    value: {
      origin: 'sample',
      legacyCode,
      modernCode,
      entryFunction,
      numRuns,
      seed,
      callTimeoutMs,
      totalTimeoutMs,
    },
  };
}

function isArbitrary(value: unknown): value is fc.Arbitrary<unknown> {
  return isRecord(value) && typeof value.generate === 'function';
}

/** Guard plus validation for `verifyEquivalence`. Never throws for any value of `raw`. */
export function normalizeEquivalenceOptions(
  raw: unknown,
): OptionsResult<NormalizedEquivalenceOptions> {
  const guard = checkOrigin(raw);
  if (guard !== null) return guard;
  const record = raw as Record<string, unknown>;
  const common = normalizeCommon(record);
  if (!common.ok) return common;
  if (!isArbitrary(record.inputArbitrary)) {
    return invalid('The option "inputArbitrary" must be a fast-check arbitrary.');
  }
  return { ok: true, value: { ...common.value, inputArbitrary: record.inputArbitrary } };
}

/** Guard plus validation for `verifyTestCode`. Never throws for any value of `raw`. */
export function normalizeTestCodeOptions(raw: unknown): OptionsResult<NormalizedTestCodeOptions> {
  const guard = checkOrigin(raw);
  if (guard !== null) return guard;
  const record = raw as Record<string, unknown>;
  const common = normalizeCommon(record);
  if (!common.ok) return common;
  if (typeof record.testCode !== 'string') {
    return invalid('The option "testCode" must be a string.');
  }
  return { ok: true, value: { ...common.value, testCode: record.testCode } };
}
