import type { CaseEntry, CaseOutcome, SandboxErrorCode, SharedErrorCode } from '../types.js';

// The Worker sends one string. Everything in it is untrusted, so each parser rebuilds the result
// from validated fields only and drops whatever else the text contains (Requirement 6, criterion 7).

export type ParseFailure = { ok: false; code: 'OUTPUT_LIMIT_EXCEEDED' | 'SANDBOX_CRASH' };
type Parsed<T> = { ok: true; value: T } | ParseFailure;

const MAX_MESSAGE = 500;
const MAX_INPUT = 2_000;
const MAX_OUTCOME = 500;
const MAX_RENDERED = 200;
const MAX_NAME = 200;

/** Error codes a Worker may report. Host-only codes (denial, unavailable, options) are not accepted. */
const WORKER_ERROR_CODES: ReadonlySet<string> = new Set<SandboxErrorCode | SharedErrorCode>([
  'LEGACY_LOAD_ERROR',
  'ENTRY_FUNCTION_NOT_FOUND',
  'MODERN_LOAD_ERROR',
  'TEST_CODE_ERROR',
  'SANDBOX_TIMEOUT',
  'SANDBOX_FORBIDDEN_CAPABILITY',
  'SANDBOX_CRASH',
  'OUTPUT_LIMIT_EXCEEDED',
  'UNSUPPORTED_VALUE',
]);

export interface WorkerError {
  kind: 'error';
  code: SandboxErrorCode | SharedErrorCode;
  message: string;
}

export type PropertyWorkerResult =
  | { kind: 'passed'; totalRuns: number }
  | { kind: 'failed'; totalRuns: number; input: string; legacyOutcome: string; modernOutcome: string; shrunk: boolean }
  | WorkerError;

export type CasesWorkerResult = { kind: 'cases'; cases: CaseEntry[] } | WorkerError;

export type CompileWorkerResult =
  | { kind: 'compiled'; js: string }
  | { kind: 'error'; code: 'MODERN_COMPILE_ERROR'; message: string };

const crash: ParseFailure = { ok: false, code: 'SANDBOX_CRASH' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown, max: number, min = 0): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

function isIntegerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function readJson(payload: string, maxResultBytes: number): Parsed<Record<string, unknown>> {
  if (Buffer.byteLength(payload, 'utf8') > maxResultBytes) return { ok: false, code: 'OUTPUT_LIMIT_EXCEEDED' };
  try {
    const value: unknown = JSON.parse(payload);
    return isRecord(value) ? { ok: true, value } : crash;
  } catch {
    return crash;
  }
}

function readError(raw: Record<string, unknown>): WorkerError | null {
  if (raw.t !== 'error' || typeof raw.code !== 'string' || !WORKER_ERROR_CODES.has(raw.code)) return null;
  if (!isText(raw.message, MAX_MESSAGE, 1)) return null;
  return { kind: 'error', code: raw.code as WorkerError['code'], message: raw.message };
}

export function parsePropertyResult(payload: string, maxResultBytes: number, numRuns: number): Parsed<PropertyWorkerResult> {
  const json = readJson(payload, maxResultBytes);
  if (!json.ok) return json;
  const raw = json.value;

  if (raw.t === 'passed') {
    return raw.runs === numRuns ? { ok: true, value: { kind: 'passed', totalRuns: numRuns } } : crash;
  }
  if (raw.t === 'failed') {
    const valid =
      isIntegerIn(raw.runs, 1, numRuns) &&
      isText(raw.input, MAX_INPUT) &&
      isText(raw.legacy, MAX_OUTCOME) &&
      isText(raw.modern, MAX_OUTCOME) &&
      typeof raw.shrunk === 'boolean';
    if (!valid) return crash;
    return {
      ok: true,
      value: {
        kind: 'failed',
        totalRuns: raw.runs as number,
        input: raw.input as string,
        legacyOutcome: raw.legacy as string,
        modernOutcome: raw.modern as string,
        shrunk: raw.shrunk as boolean,
      },
    };
  }
  const error = readError(raw);
  return error === null ? crash : { ok: true, value: error };
}

function readOutcome(raw: unknown): CaseOutcome | null {
  if (!isRecord(raw)) return null;
  if (raw.k === 'r' && isText(raw.r, MAX_RENDERED)) return { kind: 'returned', rendered: raw.r };
  if (raw.k === 't' && isText(raw.n, MAX_NAME)) return { kind: 'threw', name: raw.n };
  return null;
}

export function parseCasesResult(payload: string, maxResultBytes: number, expectedCases: number): Parsed<CasesWorkerResult> {
  const json = readJson(payload, maxResultBytes);
  if (!json.ok) return json;
  const raw = json.value;

  if (raw.t === 'cases') {
    if (!Array.isArray(raw.cases) || raw.cases.length !== expectedCases) return crash;
    const cases: CaseEntry[] = [];
    for (const item of raw.cases as unknown[]) {
      if (!isRecord(item) || typeof item.e !== 'boolean') return crash;
      const legacy = readOutcome(item.l);
      const modern = readOutcome(item.m);
      if (legacy === null || modern === null) return crash;
      cases.push({ equivalent: item.e, legacy, modern });
    }
    return { ok: true, value: { kind: 'cases', cases } };
  }
  const error = readError(raw);
  return error === null ? crash : { ok: true, value: error };
}

export function parseCompileResult(payload: string, maxResultBytes: number): Parsed<CompileWorkerResult> {
  const json = readJson(payload, maxResultBytes);
  if (!json.ok) return json;
  const raw = json.value;
  if (raw.ok === true && typeof raw.js === 'string') return { ok: true, value: { kind: 'compiled', js: raw.js } };
  if (raw.ok === false && raw.code === 'MODERN_COMPILE_ERROR' && typeof raw.message === 'string' && raw.message !== '') {
    return { ok: true, value: { kind: 'error', code: 'MODERN_COMPILE_ERROR', message: raw.message } };
  }
  return crash;
}
