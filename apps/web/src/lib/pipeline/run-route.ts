import 'server-only';

// The wrapper of the three route handlers (Requirements 3, 4, and 17). It runs the request checks, resolves the
// caller and the corpse, calls the route's handler, and turns every failure into an Error_Envelope with exactly one
// log line. A thrown value that no requirement maps to a code becomes INTERNAL_ERROR and is not rethrown.
import type { Member } from '@/lib/auth/member';
import type { PipelineDeps } from './deps';
import { errorResponse, PipelineError, StoreError, type ErrorCode } from './errors';
import type { PipelineRoute } from './log';
import { preflight } from './preflight';
import type { PipelineStore } from './store';
import type { CorpseRow, CorpseStatus } from './types';
import type { LlmConfig } from '@/lib/llm/config';

export type Access =
  | { kind: 'sample'; corpse: CorpseRow }
  | { kind: 'owned'; corpse: CorpseRow }
  | { kind: 'denied'; code: Extract<ErrorCode, 'AUTH_REQUIRED' | 'NOT_FOUND'> };

/**
 * The access table. A sample is open to everyone. A Visitor gets AUTH_REQUIRED for anything else, and a Member gets
 * NOT_FOUND for a missing or foreign corpse. Both pairs give identical responses, so a response never reveals whether
 * a private corpse exists. Row Level Security already hides foreign rows. The owner check is a second line of defense.
 */
export function resolveAccess(member: Member | null, corpse: CorpseRow | null): Access {
  if (corpse !== null && corpse.isSample) return { kind: 'sample', corpse };
  if (member === null) return { kind: 'denied', code: 'AUTH_REQUIRED' };
  if (corpse !== null && corpse.userId === member.id) return { kind: 'owned', corpse };
  return { kind: 'denied', code: 'NOT_FOUND' };
}

export interface RouteContext {
  route: PipelineRoute;
  request: Request;
  deps: PipelineDeps;
  store: PipelineStore;
  member: Member | null;
  corpse: CorpseRow;
  access: 'sample' | 'owned';
  /** The Request_Deadline combined with the signal of the incoming request. */
  deadline: AbortSignal;
  /** The instant of the Request_Deadline in the unit of `deps.now()`. */
  deadlineAt: number;
}

export interface RunRouteArgs {
  route: PipelineRoute;
  request: Request;
  deps: PipelineDeps;
  handle(context: RouteContext): Promise<Response>;
}

/**
 * Runs a cache lookup, a copy, an insert, or a re-read. A StoreError becomes PERSISTENCE_FAILED. Any other error
 * passes through to the wrapper, which turns it into INTERNAL_ERROR.
 */
export async function persisting<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StoreError) throw new PipelineError('PERSISTENCE_FAILED', { safeDetail: error.detail });
    throw error;
  }
}

/** Reads the LLM configuration. Problems give LLM_NOT_CONFIGURED, and the response names no variable. */
export function llmConfigOrFail(deps: PipelineDeps): LlmConfig {
  const result = deps.readLlmConfig();
  if (!result.ok) throw new PipelineError('LLM_NOT_CONFIGURED', { safeDetail: 'config' });
  return result.config;
}

/**
 * Moves the corpse to `next` with a guarded update, only when `next` differs from the status read at the start.
 * A failure is logged once (corpse id and failure kind only) and the caller keeps the status it had. The pipeline
 * never sets FAILED: that status belongs to POST /api/verify.
 */
export async function applyStatus(context: Pick<RouteContext, 'route' | 'deps' | 'store' | 'corpse'>, next: CorpseStatus): Promise<CorpseStatus> {
  const current = context.corpse.status;
  if (next === current || (next !== 'IN_SEANCE' && next !== 'RESURRECTED')) return current;
  try {
    const result = await context.store.setStatus(context.corpse.id, { to: next });
    return result.updated ? result.status : current;
  } catch {
    try {
      context.deps.log({ event: 'status_update_failed', route: context.route, corpseId: context.corpse.id, kind: 'error' });
    } catch {
      // A failing logger must not change the response.
    }
    return current;
  }
}

const SAFE_DETAIL = /^[A-Za-z0-9_.,:-]{1,64}$/;

function toPipelineError(error: unknown): PipelineError {
  if (error instanceof PipelineError) return error;
  if (error instanceof StoreError) return new PipelineError('INTERNAL_ERROR', { safeDetail: error.detail });
  return new PipelineError('INTERNAL_ERROR', { safeDetail: 'unexpected' });
}

export async function runPipelineRoute({ route, request, deps, handle }: RunRouteArgs): Promise<Response> {
  const startedAt = deps.now();
  let corpseId: string | null = null;
  try {
    const checked = await preflight(request, deps.appOrigin(request));
    if (!checked.ok) throw checked.error;
    corpseId = checked.corpseId;

    // Any failure of the session or the corpse query stops the request before any other step.
    let session: Awaited<ReturnType<PipelineDeps['session']>>;
    let corpse: CorpseRow | null;
    try {
      session = await deps.session();
      corpse = await session.store.loadCorpse(corpseId);
    } catch (error) {
      throw new PipelineError('INTERNAL_ERROR', { safeDetail: error instanceof StoreError ? error.detail : 'session' });
    }

    const access = resolveAccess(session.member, corpse);
    if (access.kind === 'denied') throw new PipelineError(access.code);

    return await handle({
      route,
      request,
      deps,
      store: session.store,
      member: session.member,
      corpse: access.corpse,
      access: access.kind,
      deadline: AbortSignal.any([AbortSignal.timeout(deps.limits.requestDeadlineMs), request.signal]),
      deadlineAt: startedAt + deps.limits.requestDeadlineMs,
    });
  } catch (error) {
    const failure = toPipelineError(error);
    const detail = failure.detail.safeDetail;
    try {
      deps.log({
        event: 'pipeline_error',
        route,
        code: failure.code,
        corpseId,
        elapsedMs: Math.max(0, Math.floor(deps.now() - startedAt)),
        detail: detail !== undefined && SAFE_DETAIL.test(detail) ? detail : 'none',
      });
    } catch {
      // A failing logger must not change the response.
    }
    return errorResponse(failure);
  }
}
