import 'server-only';

// POST /api/scan: the Hex Scanner (Requirement 5). It runs the deterministic curse scanner on the corpse and stores
// the findings. It never reads the LLM configuration, calls the gateway, or reserves quota. The source code is only
// text for the scanner: nothing here executes, evaluates, or imports any part of it.
import { scanCurses } from '@lazarus/mcp-curse-scanner';
import { countLines } from '../count-lines';
import type { PipelineDeps } from '../deps';
import { scanErrorToPipelineError } from '../eligibility';
import { jsonResponse, PipelineError, StoreError } from '../errors';
import { scanBody, sortCurses } from '../present';
import { runPipelineRoute } from '../run-route';
import type { CurseRowOut } from '../types';

export function handleScan(request: Request, deps: PipelineDeps): Promise<Response> {
  return runPipelineRoute({
    route: 'scan',
    request,
    deps,
    async handle({ access, corpse, store }) {
      // A Sample_Corpse returns its stored curses. Nothing is scanned and nothing is written.
      if (access === 'sample') {
        let stored: CurseRowOut[];
        try {
          stored = await store.getCurses(corpse.id);
        } catch (error) {
          throw new PipelineError('INTERNAL_ERROR', { safeDetail: error instanceof StoreError ? error.detail : 'read' });
        }
        return jsonResponse(200, scanBody('precomputed', countLines(corpse.originalCode), sortCurses(stored)));
      }

      const result = scanCurses(corpse.originalCode, corpse.sourceLanguage);
      if (!result.ok) throw scanErrorToPipelineError(result, { includePosition: true });

      const findings: CurseRowOut[] = result.curses.map((finding) => ({
        curseType: finding.curseType,
        severity: finding.severity,
        lineNumber: finding.lineNumber,
        description: finding.description,
        exorcismStrategy: finding.exorcismStrategy,
      }));

      // One transaction replaces the stored set. A failure leaves the previous rows unchanged.
      try {
        await store.replaceCurses(corpse.id, findings);
      } catch (error) {
        throw new PipelineError('INTERNAL_ERROR', { safeDetail: error instanceof StoreError ? error.detail : 'replace' });
      }
      return jsonResponse(200, scanBody('generated', result.lineCount, sortCurses(findings)));
    },
  });
}
