// Number and time formatting for the stage screens. Pure module: no framework imports, no process.env.
import { pluralize } from '@/lib/ui/format';

/**
 * Formats an integer with a comma as the thousands separator, for example 1234567 gives "1,234,567".
 * The digits are never rounded or abbreviated. A value that is not an integer is returned as `String(value)`.
 * Callers pass a validated run count or duration.
 */
export function formatRunCount(value: number): string {
  if (!Number.isInteger(value)) return String(value);
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Formats a duration in milliseconds, for example 1842 gives "1,842 ms". */
export function formatDuration(ms: number): string {
  return `${formatRunCount(ms)} ms`;
}

/**
 * Formats a wait time rounded up: under 60 seconds in seconds, under 3,600 seconds in whole minutes, and otherwise
 * in whole hours. A value below one second, or one that is not finite, is shown as one second.
 */
export function formatRetryAfter(seconds: number): string {
  const wait = Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : 1;
  if (wait < 60) return pluralize(wait, 'second');
  if (wait < 3600) return pluralize(Math.ceil(wait / 60), 'minute');
  return pluralize(Math.ceil(wait / 3600), 'hour');
}
