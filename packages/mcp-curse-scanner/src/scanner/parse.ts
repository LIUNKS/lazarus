import * as acorn from 'acorn';
import { MESSAGES } from './constants.js';
import { ScanAbort, type Deadline } from './deadline.js';
import { Es3Parser } from './es3-reserved.js';
import type { LineIndex } from './line-index.js';
import type { ScanError, SourceLanguage } from './types.js';
import type { TreeNode } from './visit.js';

export type ParseOutcome = { ok: true; program: TreeNode } | { ok: false; error: ScanError };

const MAX_MESSAGE_LENGTH = 500;

function optionsFor(language: SourceLanguage, deadline: Deadline): acorn.Options {
  const base = { sourceType: 'script', onToken: () => deadline.step() } as const;
  switch (language) {
    case 'es3':
      return { ...base, ecmaVersion: 3, allowReserved: false };
    case 'es5-jquery':
      return { ...base, ecmaVersion: 5 };
    case 'legacy-node':
      return { ...base, ecmaVersion: 5, allowHashBang: true, allowReturnOutsideFunction: true };
  }
}

function isStackExhaustion(error: unknown): boolean {
  return (
    error instanceof RangeError ||
    (error instanceof SyntaxError && error.message.startsWith('Not enough stack space to parse input'))
  );
}

export function parseSource(
  source: string,
  language: SourceLanguage,
  lineIndex: LineIndex,
  deadline: Deadline,
): ParseOutcome {
  const options = optionsFor(language, deadline);
  try {
    const program = language === 'es3' ? Es3Parser.parse(source, options) : acorn.parse(source, options);
    return { ok: true, program: program as unknown as TreeNode };
  } catch (error) {
    if (error instanceof ScanAbort) throw error;
    if (isStackExhaustion(error)) {
      return { ok: false, error: { ok: false, code: 'LIMIT_EXCEEDED', message: MESSAGES.parserLimit } };
    }
    if (error instanceof SyntaxError && typeof (error as { pos?: unknown }).pos === 'number') {
      const { line, column } = lineIndex.position((error as unknown as { pos: number }).pos);
      const message = error.message.replace(/ \(\d+:\d+\)$/, '').slice(0, MAX_MESSAGE_LENGTH);
      return { ok: false, error: { ok: false, code: 'SYNTAX_ERROR', message, line, column } };
    }
    throw error;
  }
}
