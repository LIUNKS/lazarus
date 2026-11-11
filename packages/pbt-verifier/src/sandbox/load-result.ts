import type { ErrorCode } from '../types.js';
import type { Sandbox, SandboxFunction } from './context.js';

/** An Entry_Function together with the sandbox it lives in. */
export interface LoadedSide {
  sandbox: Sandbox;
  fn: SandboxFunction;
}

export interface LoadFailure {
  ok: false;
  code: ErrorCode;
  message: string;
}

/** Result of loading one side. The pipeline adds `executionTimeMs` when it turns a failure into a result. */
export type LoadResult = { ok: true; value: LoadedSide } | LoadFailure;

export function loadFailure(code: ErrorCode, message: string): LoadFailure {
  return { ok: false, code, message };
}

/** Message for a missing Entry_Function that names the side where it is missing. */
export function missingEntryMessage(entryFunction: string, side: 'legacy' | 'modern'): string {
  return side === 'legacy'
    ? `The entry function "${entryFunction}" was not found in the legacy code. Declare it as a top-level function.`
    : `The entry function "${entryFunction}" was not found in the modern code. Export it with the same name.`;
}
