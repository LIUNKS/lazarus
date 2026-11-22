// Timing and text decisions of the animations (09-motion-ux). Pure module: no gsap, no React, no DOM, no process.env.
// Server Components may import its constants, because it is not a client module.
import { formatRunCount } from '@/lib/stages/format';

/** Animations run only while this query matches. Otherwise the server-rendered final state stays as it is. */
export const MOTION_QUERY = '(prefers-reduced-motion: no-preference)';

/** The links that scroll smoothly: the "Line N" links of the Hex Scanner and the links of the stage overview. */
export const LINE_LINK_SELECTOR = 'a[href^="#source-line-"], nav[aria-label="Resurrection stages"] a[href^="#"]';

export const SWEEP_MIN_SECONDS = 1.2;
export const SWEEP_MAX_SECONDS = 3.2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** How long the scan beam takes to cross a source of `lineCount` lines. Grows with the count, within 1.2 to 3.2 s. */
export function sweepDuration(lineCount: number): number {
  if (!Number.isFinite(lineCount)) return SWEEP_MIN_SECONDS;
  return clamp(0.9 + 0.03 * Math.max(0, lineCount), SWEEP_MIN_SECONDS, SWEEP_MAX_SECONDS);
}

export interface CrossingGeometry {
  /** Vertical center of the line, in pixels from the top of the view. */
  center: number;
  viewHeight: number;
  beamHeight: number;
  /** Duration of the whole sweep, in seconds. */
  duration: number;
}

/**
 * The time at which the center of the beam crosses `center`. The top edge of the beam moves linearly from `-beamHeight`
 * to `viewHeight` over `duration`. The result is always within 0 and `duration`; invalid geometry gives 0.
 */
export function crossingTime({ center, viewHeight, beamHeight, duration }: CrossingGeometry): number {
  const travel = viewHeight + beamHeight;
  if (![center, viewHeight, beamHeight, duration].every(Number.isFinite) || travel <= 0 || duration <= 0) return 0;
  return clamp((center + beamHeight / 2) / travel, 0, 1) * duration;
}

/**
 * One frame of the run-count animation: the first occurrence of the formatted `target` in `text` is replaced by the
 * formatted `current` (rounded and kept within 0 and `target`). A text without that occurrence is returned unchanged,
 * and `countFrame(text, n, n)` is always `text`, so the animation ends in the final state.
 */
export function countFrame(text: string, target: number, current: number): string {
  const formatted = formatRunCount(target);
  const index = text.indexOf(formatted);
  if (index === -1) return text;
  const value = Number.isFinite(current) ? clamp(Math.round(current), 0, target) : target;
  return text.slice(0, index) + formatRunCount(value) + text.slice(index + formatted.length);
}

/** The id that an in-page link points to (`#<id>`), or null for anything else. */
export function hashTarget(href: string | null): string | null {
  if (href === null || !href.startsWith('#') || href.length < 2) return null;
  try {
    return decodeURIComponent(href.slice(1));
  } catch {
    return null;
  }
}

export interface ClickLike {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

/** Only a plain primary-button click glides. Modified clicks keep the browser behavior (new tab, new window, ...). */
export function shouldGlide(event: ClickLike): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.defaultPrevented;
}
