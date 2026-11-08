import { MESSAGES } from './constants.js';
import { createDeadline, ScanAbort } from './deadline.js';
import { checkInput } from './input.js';
import { createLineIndex } from './line-index.js';
import { parseSource } from './parse.js';
import { scanError, scanSuccess, signaturesSuccess } from './results.js';
import type { ScanResult, SignaturesResult } from './types.js';
import { analyzeTree } from './visit.js';

export interface ScanHooks {
  now: () => number;
  timeBudgetMs: number;
}

// Never throws: every failure maps to one of the five Scan_Error codes.
export function runScan(
  source: unknown,
  language: unknown,
  mode: 'curses' | 'functions',
  hooks: Partial<ScanHooks> = {},
): ScanResult | SignaturesResult {
  try {
    const input = checkInput(source, language);
    if (!input.ok) return input.error;

    const deadline = createDeadline(hooks);
    const lineIndex = createLineIndex(input.source);

    const parsed = parseSource(input.source, input.language, lineIndex, deadline);
    if (!parsed.ok) return parsed.error;
    deadline.check();

    const outcome = analyzeTree(parsed.program, lineIndex, deadline);
    if (!outcome.ok) return scanError(outcome.code, outcome.message);

    return mode === 'curses'
      ? scanSuccess(input.language, lineIndex.lineCount, outcome.curses)
      : signaturesSuccess(input.language, lineIndex.lineCount, outcome.functions);
  } catch (error) {
    if (error instanceof ScanAbort) return scanError('TIMEOUT', MESSAGES.timeout);
    return scanError('LIMIT_EXCEEDED', MESSAGES.internalFailure);
  }
}
