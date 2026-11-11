import type { Counterexample } from '@lazarus/pbt-verifier/shared';

export type { Counterexample };

/** Where the code comes from. The caller derives it from the database row, never from client input. */
export type Origin = 'sample' | 'user';

export type Caller = { kind: 'anonymous' } | { kind: 'member'; userId: string };

export interface GateConfig {
  /** Default `false`: user-imported code does not run until an operator enables it. */
  userExecutionEnabled: boolean;
  /** Default `false`: anonymous visitors see precomputed sample results only. */
  allowAnonymousSampleRuns: boolean;
  /** Integer >= 1. Default 1. Counted per process. */
  perUserConcurrency: number;
  /** Integer >= 1. Default 4. Counted per process. */
  globalConcurrency: number;
}

export type DenialReason =
  | 'INVALID_REQUEST'
  | 'ANONYMOUS_NOT_ALLOWED'
  | 'AUTH_REQUIRED'
  | 'USER_EXECUTION_DISABLED'
  | 'NOT_OWNER'
  | 'USER_CONCURRENCY_LIMIT'
  | 'GLOBAL_CONCURRENCY_LIMIT';

/** Every field is an integer inside the stated inclusive range (Requirement 5, criterion 1). */
export interface SandboxLimits {
  /** 100 to 60000. Default 10000. */
  wallClockTimeoutMs?: number;
  /** 1 to 10000. Default 1000. */
  caseTimeoutMs?: number;
  /** 1000 to 30000. Default 10000. */
  compileTimeoutMs?: number;
  /** 32 to 512. Default 128. */
  maxOldGenerationSizeMb?: number;
  /** 8 to 64. Default 16. */
  maxYoungGenerationSizeMb?: number;
  /** 16 to 1024. Default 256. */
  maxExternalMemoryMb?: number;
  /** 1024 to 262144. Default 65536. */
  maxValueBytes?: number;
  /** 4096 to 2097152. Default 524288. */
  maxResultBytes?: number;
  /** 1024 to 1048576. Default 262144. */
  maxSourceBytes?: number;
}

export type ResolvedLimits = Required<SandboxLimits>;

export interface SandboxVerifyOptions {
  legacyCode: string;
  modernCode: string;
  entryFunction: string;
  testCode: string;
  /** Integer from 100 to 1000. Default 1000. */
  numRuns?: number;
  /** 32-bit signed integer. Default `Date.now() | 0`. */
  seed?: number;
  /** Default `false`. The isolation does not depend on this setting. */
  allowDynamicCode?: boolean;
  limits?: SandboxLimits;
}

export interface SandboxCasesOptions {
  legacyCode: string;
  modernCode: string;
  entryFunction: string;
  /** 1 to 1000 values. */
  inputs: unknown[];
  allowDynamicCode?: boolean;
  limits?: SandboxLimits;
}

export interface LiveRequest extends SandboxVerifyOptions {
  origin: Origin;
  caller: Caller;
  corpusOwnerId: string | null;
}

export type SandboxErrorCode =
  | 'LIVE_EXECUTION_DENIED'
  | 'SANDBOX_UNAVAILABLE'
  | 'SANDBOX_TIMEOUT'
  | 'SANDBOX_OUT_OF_MEMORY'
  | 'SANDBOX_FORBIDDEN_CAPABILITY'
  | 'SANDBOX_CRASH'
  | 'OUTPUT_LIMIT_EXCEEDED'
  | 'UNSUPPORTED_VALUE';

/** Verifier codes that the Sandbox can still produce. */
export type SharedErrorCode =
  | 'INVALID_OPTIONS'
  | 'LEGACY_LOAD_ERROR'
  | 'ENTRY_FUNCTION_NOT_FOUND'
  | 'MODERN_COMPILE_ERROR'
  | 'MODERN_LOAD_ERROR'
  | 'TEST_CODE_ERROR'
  | 'INTERNAL_ERROR';

export type Executor = 'sandbox-worker' | 'in-process' | 'none';

export interface SandboxPassedResult {
  status: 'PASSED';
  executor: Executor;
  totalRuns: number;
  seed: number;
  executionTimeMs: number;
  evidence: string;
}

export interface SandboxFailedResult {
  status: 'FAILED';
  executor: Executor;
  totalRuns: number;
  seed: number;
  executionTimeMs: number;
  counterexample: Counterexample;
  evidence: string;
}

export interface SandboxErrorResult {
  status: 'ERROR';
  executor: Executor;
  code: SandboxErrorCode | SharedErrorCode;
  message: string;
  executionTimeMs: number;
  reason?: DenialReason;
}

/** The value property mode resolves to. JSON-serializable by construction. */
export type SandboxResult = SandboxPassedResult | SandboxFailedResult | SandboxErrorResult;

export type CaseOutcome =
  | { kind: 'returned'; rendered: string }
  | { kind: 'threw'; name: string };

export interface CaseEntry {
  equivalent: boolean;
  legacy: CaseOutcome;
  modern: CaseOutcome;
}

/** A list of cases is not a verification, so this result carries no evidence text. */
export type CasesResult =
  | { status: 'COMPLETED'; executor: 'sandbox-worker'; executionTimeMs: number; cases: CaseEntry[] }
  | SandboxErrorResult;
