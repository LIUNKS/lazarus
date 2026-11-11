import type { NormalizedCommonOptions } from '../options.js';
import { loadLegacy } from '../sandbox/legacy-loader.js';
import type { LoadFailure } from '../sandbox/load-result.js';
import { loadModern } from '../sandbox/modern-loader.js';
import { createAssertEquivalent, makeSide, type Side } from './sides.js';
import type { RunState } from './run-state.js';

/** Everything both modes need once the two sides are loaded. */
export interface PreparedSides {
  legacy: Side;
  modern: Side;
  assertEquivalent: (input: unknown) => undefined;
}

/**
 * Loads the legacy side, then the modern side, and wraps both (design, pipeline order). The first
 * failure is returned as is, so a legacy error is never hidden by a modern one.
 */
export function prepareSides(
  options: NormalizedCommonOptions,
  state: RunState,
): ({ ok: true } & PreparedSides) | LoadFailure {
  const legacyLoad = loadLegacy(options.legacyCode, options.entryFunction, options.callTimeoutMs);
  if (!legacyLoad.ok) return legacyLoad;
  const modernLoad = loadModern(options.modernCode, options.entryFunction, options.callTimeoutMs);
  if (!modernLoad.ok) return modernLoad;

  const legacy = makeSide(
    legacyLoad.value.sandbox,
    legacyLoad.value.fn,
    'legacy',
    state,
    options.callTimeoutMs,
  );
  const modern = makeSide(
    modernLoad.value.sandbox,
    modernLoad.value.fn,
    'modern',
    state,
    options.callTimeoutMs,
  );
  return { ok: true, legacy, modern, assertEquivalent: createAssertEquivalent(legacy, modern, state) };
}
