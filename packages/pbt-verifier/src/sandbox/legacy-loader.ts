import { createEntryReader, createSandbox, describeThrown } from './context.js';
import { loadFailure, missingEntryMessage, type LoadResult } from './load-result.js';

/**
 * Loads Legacy_Code unmodified, as a classic script in a fresh sandbox (Requirement 4). The sandbox
 * defines none of `$`, `jQuery`, `window`, `document`, `global`, `module`, `exports`, or `require`, so
 * code that depends on them fails visibly. The source is evaluated once per verification.
 *
 * `timeoutMs` bounds the top-level code of the script, so a loop at load time cannot hang the caller.
 */
export function loadLegacy(code: string, entryFunction: string, timeoutMs: number): LoadResult {
  const sandbox = createSandbox();
  // Created before the legacy code runs, so the legacy code cannot tamper with the lookup.
  const readEntry = createEntryReader(sandbox, 'globalThis', timeoutMs);

  try {
    sandbox.evaluate(code, 'legacy.js', timeoutMs);
  } catch (error) {
    return loadFailure('LEGACY_LOAD_ERROR', describeThrown(error));
  }

  const fn = readEntry(entryFunction, timeoutMs);
  if (fn === undefined) {
    return loadFailure('ENTRY_FUNCTION_NOT_FOUND', missingEntryMessage(entryFunction, 'legacy'));
  }
  return { ok: true, value: { sandbox, fn } };
}
