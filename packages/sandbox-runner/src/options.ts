import type { ResolvedLimits } from './types.js';

interface Range {
  min: number;
  max: number;
  fallback: number;
}

/** Defaults and inclusive ranges of Requirement 5, criterion 1. */
export const LIMIT_RANGES: Readonly<Record<keyof ResolvedLimits, Range>> = {
  wallClockTimeoutMs: { min: 100, max: 60_000, fallback: 10_000 },
  caseTimeoutMs: { min: 1, max: 10_000, fallback: 1_000 },
  compileTimeoutMs: { min: 1_000, max: 30_000, fallback: 10_000 },
  maxOldGenerationSizeMb: { min: 32, max: 512, fallback: 128 },
  maxYoungGenerationSizeMb: { min: 8, max: 64, fallback: 16 },
  maxExternalMemoryMb: { min: 16, max: 1_024, fallback: 256 },
  maxValueBytes: { min: 1_024, max: 262_144, fallback: 65_536 },
  maxResultBytes: { min: 4_096, max: 2_097_152, fallback: 524_288 },
  maxSourceBytes: { min: 1_024, max: 1_048_576, fallback: 262_144 },
};

export const NUM_RUNS_RANGE = { min: 100, max: 1_000, fallback: 1_000 } as const;
export const INPUTS_RANGE = { min: 1, max: 1_000 } as const;
const SEED_RANGE = { min: -2_147_483_648, max: 2_147_483_647 } as const;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Same list as the Verifier: words that cannot name a function binding in ES2022 strict-mode code. */
const RESERVED_WORDS: ReadonlySet<string> = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
  'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if',
  'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package',
  'private', 'protected', 'public', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true',
  'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
]);

interface ResolvedCommon {
  legacyCode: string;
  modernCode: string;
  entryFunction: string;
  allowDynamicCode: boolean;
  limits: ResolvedLimits;
}

export interface ResolvedVerifyOptions extends ResolvedCommon {
  testCode: string;
  numRuns: number;
  seed: number;
}

export interface ResolvedCasesOptions extends ResolvedCommon {
  inputs: unknown[];
}

export interface OptionsFailure {
  ok: false;
  code: 'INVALID_OPTIONS';
  message: string;
}

export type OptionsResult<T> = { ok: true; value: T } | OptionsFailure;

function invalid(message: string): OptionsFailure {
  return { ok: false, code: 'INVALID_OPTIONS', message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIntegerInRange(value: unknown, range: { min: number; max: number }): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= range.min && value <= range.max;
}

function resolveLimits(raw: unknown): OptionsResult<ResolvedLimits> {
  if (raw !== undefined && !isRecord(raw)) return invalid('The option "limits" must be an object.');
  const given = raw ?? {};
  const limits = {} as ResolvedLimits;
  for (const name of Object.keys(LIMIT_RANGES) as (keyof ResolvedLimits)[]) {
    const range = LIMIT_RANGES[name];
    const value = given[name] === undefined ? range.fallback : given[name];
    if (!isIntegerInRange(value, range)) {
      return invalid(`The limit "${name}" must be an integer from ${range.min} to ${range.max}.`);
    }
    limits[name] = value;
  }
  return { ok: true, value: limits };
}

function resolveCommon(raw: Record<string, unknown>, codeFields: readonly string[]): OptionsResult<ResolvedCommon> {
  for (const field of codeFields) {
    if (typeof raw[field] !== 'string') return invalid(`The option "${field}" must be a string.`);
  }
  const { entryFunction, allowDynamicCode } = raw;
  if (typeof entryFunction !== 'string' || !IDENTIFIER.test(entryFunction)) {
    return invalid('The option "entryFunction" must be a valid ECMAScript identifier.');
  }
  if (RESERVED_WORDS.has(entryFunction)) {
    return invalid('The option "entryFunction" must not be a reserved word.');
  }
  if (allowDynamicCode !== undefined && typeof allowDynamicCode !== 'boolean') {
    return invalid('The option "allowDynamicCode" must be a boolean.');
  }

  const limits = resolveLimits(raw.limits);
  if (!limits.ok) return limits;

  for (const field of codeFields) {
    if (Buffer.byteLength(raw[field] as string, 'utf8') > limits.value.maxSourceBytes) {
      return invalid(`The option "${field}" exceeds the limit "maxSourceBytes" (${limits.value.maxSourceBytes} bytes).`);
    }
  }

  return {
    ok: true,
    value: {
      legacyCode: raw.legacyCode as string,
      modernCode: raw.modernCode as string,
      entryFunction,
      allowDynamicCode: allowDynamicCode === true,
      limits: limits.value,
    },
  };
}

/** Validates the options of property mode (Requirement 9, criterion 1). Never throws. */
export function resolveVerifyOptions(raw: unknown): OptionsResult<ResolvedVerifyOptions> {
  try {
    if (!isRecord(raw)) return invalid('The options must be an object.');
    const common = resolveCommon(raw, ['legacyCode', 'modernCode', 'testCode']);
    if (!common.ok) return common;

    const numRuns = raw.numRuns === undefined ? NUM_RUNS_RANGE.fallback : raw.numRuns;
    if (!isIntegerInRange(numRuns, NUM_RUNS_RANGE)) {
      return invalid(`The option "numRuns" must be an integer from ${NUM_RUNS_RANGE.min} to ${NUM_RUNS_RANGE.max}.`);
    }
    const seed = raw.seed === undefined ? Date.now() | 0 : raw.seed;
    if (!isIntegerInRange(seed, SEED_RANGE)) return invalid('The option "seed" must be a 32-bit signed integer.');

    return { ok: true, value: { ...common.value, testCode: raw.testCode as string, numRuns, seed } };
  } catch {
    return invalid('The options could not be read.');
  }
}

/** Validates the options of cases mode (Requirement 10, criteria 1 and 2). Never throws. */
export function resolveCasesOptions(raw: unknown): OptionsResult<ResolvedCasesOptions> {
  try {
    if (!isRecord(raw)) return invalid('The options must be an object.');
    const common = resolveCommon(raw, ['legacyCode', 'modernCode']);
    if (!common.ok) return common;

    const { inputs } = raw;
    if (!Array.isArray(inputs) || inputs.length < INPUTS_RANGE.min || inputs.length > INPUTS_RANGE.max) {
      return invalid(`The option "inputs" must be an array of ${INPUTS_RANGE.min} to ${INPUTS_RANGE.max} values.`);
    }
    return { ok: true, value: { ...common.value, inputs } };
  } catch {
    return invalid('The options could not be read.');
  }
}
