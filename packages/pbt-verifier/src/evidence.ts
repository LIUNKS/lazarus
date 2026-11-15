import type { FailedResult, PassedResult, VerificationResult } from './types.js';

/**
 * Phrases that claim more than a test run shows (Requirement 10, criterion 5). Matching is
 * case-insensitive. Any of them found in a result string is replaced with `[redacted]`.
 */
const BANNED_PHRASES = /100%|mathematical proof|mathematically proven|guaranteed/gi;
const REDACTED = '[redacted]';

/** Formats an integer with a comma as the thousands separator, without any locale lookup. */
function groupThousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * The one place that writes the evidence sentence (Requirement 10, criteria 1 to 4). The `evidence`
 * field of every PASSED and FAILED result is produced by this function, so the two cannot diverge.
 * The seed is printed as is.
 */
export function formatEvidence(result: PassedResult | FailedResult): string {
  const runs = groupThousands(result.totalRuns);
  return result.status === 'PASSED'
    ? `Verified behavioral equivalence across ${runs} generated inputs (seed ${result.seed}).`
    : `Found a behavioral difference after ${runs} generated inputs (seed ${result.seed}).`;
}

function redact(value: string): string {
  return value.replace(BANNED_PHRASES, REDACTED);
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (typeof value === 'object' && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = sanitizeValue(item);
    return copy;
  }
  return value;
}

/**
 * Returns a copy of `result` in which every string field has its banned phrases replaced. User code
 * can put such text in a result (for example, in the message of an error it throws), and the Verifier
 * must never repeat a claim it does not make.
 */
export function sanitizeResult<T extends VerificationResult>(result: T): T {
  return sanitizeValue(result) as T;
}
