import type { ResolvedLimits } from '../types.js';
import { parseCompileResult } from './result-parser.js';
import { failureOfEnd, type Failure } from './run-shared.js';
import { spawnRun } from './supervisor.js';

/** Old-generation limit of the Compile_Worker (Requirement 5, criterion 10). */
const COMPILE_OLD_GENERATION_MB = 256;

export type CompileStageResult = { ok: true; js: string } | ({ ok: false } & Failure);

/**
 * Type-checks and transpiles Modern_Code in a Compile_Worker, so a pathological type-check cannot
 * block the host. The compiler never executes the code.
 */
export async function compileStage(
  modernCode: string,
  entryFunction: string,
  limits: ResolvedLimits,
): Promise<CompileStageResult> {
  // Transpiled text is about as long as its source. The cap only bounds what the host will parse.
  const maxResultBytes = limits.maxSourceBytes * 4 + 65_536;
  const end = await spawnRun(
    'compile',
    { modernCode, entryFunction },
    {
      killAfterMs: limits.compileTimeoutMs,
      maxOldGenerationSizeMb: COMPILE_OLD_GENERATION_MB,
      maxYoungGenerationSizeMb: limits.maxYoungGenerationSizeMb,
      maxExternalMemoryMb: limits.maxExternalMemoryMb,
      maxResultBytes,
    },
  );
  if (end.kind !== 'message') return { ok: false, ...failureOfEnd(end, 'compile') };

  const parsed = parseCompileResult(end.payload, maxResultBytes);
  if (!parsed.ok) {
    return { ok: false, code: parsed.code, message: 'The compile stage returned an invalid result.' };
  }
  if (parsed.value.kind === 'error') return { ok: false, code: parsed.value.code, message: parsed.value.message };
  return { ok: true, js: parsed.value.js };
}
