import { MESSAGES, SOURCE_LANGUAGES } from './constants.js';
import { LIMITS } from './limits.js';
import type { ScanError, SourceLanguage } from './types.js';

export type InputCheck =
  | { ok: true; source: string; language: SourceLanguage }
  | { ok: false; error: ScanError };

function isSourceLanguage(value: unknown): value is SourceLanguage {
  return typeof value === 'string' && (SOURCE_LANGUAGES as readonly string[]).includes(value);
}

// Error precedence of Requirement 12.9: INVALID_INPUT, then INPUT_TOO_LARGE.
export function checkInput(source: unknown, language: unknown): InputCheck {
  if (typeof source !== 'string' || !isSourceLanguage(language)) {
    return { ok: false, error: { ok: false, code: 'INVALID_INPUT', message: MESSAGES.invalidInput } };
  }
  // Node counts a lone surrogate as U+FFFD (3 bytes), which equals the rule of Requirement 12.2.
  if (Buffer.byteLength(source, 'utf8') > LIMITS.sourceSizeBytes) {
    return { ok: false, error: { ok: false, code: 'INPUT_TOO_LARGE', message: MESSAGES.inputTooLarge } };
  }
  return { ok: true, source, language };
}
