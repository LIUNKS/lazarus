import 'server-only';

// The wrapper of POST /api/verify (Requirements 2, 3, and 9). It mirrors the contract of runPipelineRoute of 05,
// which cannot be reused because its error table is fixed (design Open Item 4): it runs the request checks of 05,
// resolves the caller and the corpse, calls the handler, and turns every failure into an Error_Envelope with exactly
// one log line. A thrown value that no requirement maps to a code becomes INTERNAL_ERROR and is not rethrown.
// It has no deadline of its own: the Sandbox_Runner bounds the run.
import type { Member } from '@/lib/auth/member';
import { PipelineError, StoreError } from '@/lib/pipeline/errors';
import { preflight } from '@/lib/pipeline/preflight';
import { resolveAccess } from '@/lib/pipeline/run-route';
import type { CorpseRow } from '@/lib/pipeline/types';
import type { VerifyDeps } from './deps';
import { isVerifyErrorCode, VerifyError, verifyErrorResponse } from './errors';
import type { VerificationStore } from './store';

export interface VerifyContext {
  request: Request;
  deps: VerifyDeps;
  store: VerificationStore;
  member: Member | null;
  corpse: CorpseRow;
  access: 'sample' | 'owned';
}

const SAFE_DETAIL = /^[A-Za-z0-9_.,:-]{1,64}$/;

function toVerifyError(error: unknown): VerifyError {
  if (error instanceof VerifyError) return error;
  // The request checks of 05 report codes that this route shares with 05.
  if (error instanceof PipelineError && isVerifyErrorCode(error.code)) return new VerifyError(error.code);
  if (error instanceof StoreError) return new VerifyError('INTERNAL_ERROR', { safeDetail: error.detail });
  return new VerifyError('INTERNAL_ERROR', { safeDetail: 'unexpected' });
}

export async function runVerifyRoute(request: Request, deps: VerifyDeps, handle: (context: VerifyContext) => Promise<Response>): Promise<Response> {
  const startedAt = deps.now();
  let corpseId: string | null = null;
  try {
    // The checks of Requirement 3 of 05, in their order, all before any database access.
    const checked = await preflight(request, deps.appOrigin(request));
    if (!checked.ok) throw checked.error;
    corpseId = checked.corpseId;

    // Any failure of the session or the corpse query stops the request before any other step.
    let session: Awaited<ReturnType<VerifyDeps['session']>>;
    let corpse: CorpseRow | null;
    try {
      session = await deps.session();
      corpse = await session.store.loadCorpse(corpseId);
    } catch (error) {
      throw new VerifyError('INTERNAL_ERROR', { safeDetail: error instanceof StoreError ? error.detail : 'session' });
    }

    const access = resolveAccess(session.member, corpse);
    if (access.kind === 'denied') throw new VerifyError(access.code);

    return await handle({ request, deps, store: session.store, member: session.member, corpse: access.corpse, access: access.kind });
  } catch (error) {
    const failure = toVerifyError(error);
    const detail = failure.detail.safeDetail;
    try {
      deps.log({
        event: 'verification_error',
        route: 'verify',
        code: failure.code,
        corpseId,
        elapsedMs: Math.max(0, Math.floor(deps.now() - startedAt)),
        detail: detail !== undefined && SAFE_DETAIL.test(detail) ? detail : 'none',
      });
    } catch {
      // A failing logger must not change the response.
    }
    return verifyErrorResponse(failure);
  }
}
