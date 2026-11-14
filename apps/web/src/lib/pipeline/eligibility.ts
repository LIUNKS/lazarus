// Source eligibility for the LLM stages (Requirement 6). Pure module: it only reads the source text through
// the Curse_Scanner library and never executes, evaluates, or imports any part of it.
import {
  extractFunctionSignatures,
  scanCurses,
  type CurseFinding,
  type ScanError,
} from '@lazarus/mcp-curse-scanner';
import { PipelineError } from './errors';
import { LIMITS } from './limits';
import type { EntryCandidate, SourceLanguage } from './types';

export type Eligibility =
  | { ok: true; candidates: EntryCandidate[]; findings: CurseFinding[]; lineCount: number }
  | { ok: false; error: PipelineError };

/**
 * Maps a Scan_Error to the pipeline error. `SYNTAX_ERROR` becomes SOURCE_SYNTAX_ERROR and every other code
 * becomes SOURCE_NOT_SCANNABLE. The position is attached only when asked for (the scan route puts it in the message).
 */
export function scanErrorToPipelineError(error: ScanError, options: { includePosition: boolean }): PipelineError {
  const code = error.code === 'SYNTAX_ERROR' ? 'SOURCE_SYNTAX_ERROR' : 'SOURCE_NOT_SCANNABLE';
  if (!options.includePosition) return new PipelineError(code, { safeDetail: error.code });
  return new PipelineError(code, {
    safeDetail: error.code,
    ...(error.line === undefined ? {} : { line: error.line }),
    ...(error.column === undefined ? {} : { column: error.column }),
  });
}

/** Checks run in this order and stop at the first failure: size, scan, Entry_Candidate. */
export function checkEligibility(originalCode: string, language: SourceLanguage): Eligibility {
  // 1. Size: UTF-8 bytes. Exactly Max_LLM_Source_Bytes passes.
  if (new TextEncoder().encode(originalCode).length > LIMITS.maxLlmSourceBytes) {
    return { ok: false, error: new PipelineError('SOURCE_TOO_LARGE') };
  }

  // 2. Scan: scanCurses first, then extractFunctionSignatures. The first Scan_Error is the one reported.
  const scan = scanCurses(originalCode, language);
  if (!scan.ok) return { ok: false, error: scanErrorToPipelineError(scan, { includePosition: false }) };
  const signatures = extractFunctionSignatures(originalCode, language);
  if (!signatures.ok) return { ok: false, error: scanErrorToPipelineError(signatures, { includePosition: false }) };

  // 3. Entry_Candidates: top-level named function declarations, in source order.
  const candidates: EntryCandidate[] = [];
  for (const fn of signatures.functions) {
    if (fn.kind === 'declaration' && fn.nestingDepth === 0 && fn.name !== null) {
      candidates.push({
        name: fn.name,
        params: [...fn.params],
        pureCandidate: fn.pureCandidate,
        impurityMarkers: [...fn.impurityMarkers],
      });
    }
  }
  if (candidates.length === 0) return { ok: false, error: new PipelineError('NO_ENTRY_FUNCTION') };

  return { ok: true, candidates, findings: scan.curses, lineCount: scan.lineCount };
}
