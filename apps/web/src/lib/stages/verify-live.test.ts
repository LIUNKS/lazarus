import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { actionReducer, isLocked } from './action-state';
import {
  VERIFY_HELP_TEXT,
  VERIFY_LABEL,
  VERIFY_PENDING_TEXT,
  VERIFY_SAMPLE_HELP_TEXT,
  stageControls,
  type StageAccess,
  type StageFacts,
} from './controls';
import { FAILURE_PRESENTATIONS, PIPELINE_ERROR_CODES, presentFailure, presentLiveSuccess, presentSuccess } from './errors';
import {
  PIPELINE_PATHS,
  RESULT_SOURCES,
  VERIFY_CLIENT_TIMEOUT_MS,
  isResultSource,
  parseOutcome,
  runPipeline,
  type PipelineRoute,
} from './pipeline-client';
import type { VerificationState } from './verification';
import { containsForbiddenTerm } from './wording';

const CORPSE_ID = '3f6c1b2e-7a4d-4e8b-9c15-2d0a8b6f4e73';
const ACCESS: StageAccess[] = ['visitor', 'member-viewer', 'owner'];
const STATES: Array<VerificationState | null> = ['NOT_RUN', 'VERIFIED', 'FAILED', 'INCOMPLETE', null];
const ROUTES = Object.keys(PIPELINE_PATHS) as PipelineRoute[];
const ALL_SOURCES = ['precomputed', 'stored', 'cache', 'generated', 'executed', 'live'] as const;

const facts = (verificationState: VerificationState | null): StageFacts => ({
  curseCount: 2,
  hasSeance: true,
  seanceApproved: true,
  hasReincarnation: verificationState !== null,
  verificationState,
  isSample: false,
  liveVerificationEnabled: true,
});

describe('R16.10 R8.9 the verify control in stageControls', () => {
  it.each(ACCESS.flatMap((access) => STATES.map((state) => [access, state] as const)))(
    'for access %s and verification state %s, "verify" is available only for the owner with a NOT_RUN reincarnation',
    (access, state) => {
      const expected = access === 'owner' && state === 'NOT_RUN';
      expect(stageControls(access, facts(state)).verify).toEqual(expected ? { available: true } : { available: false, reason: null });
    },
  );

  it('R8.9 offers no verification when no reincarnation exists, even if the state says NOT_RUN', () => {
    const inconsistent: StageFacts = { ...facts('NOT_RUN'), hasReincarnation: false };
    expect(stageControls('owner', inconsistent).verify).toEqual({ available: false, reason: null });
  });

  it('R18.3 words the label, the help text, and the pending text exactly, with no limit value and no run count', () => {
    expect(VERIFY_LABEL).toBe('Verify live');
    expect(VERIFY_HELP_TEXT).toBe(
      'Runs the legacy and the modern function in an isolated environment on generated inputs. This can take up to a minute and counts toward a separate verification limit.',
    );
    expect(VERIFY_PENDING_TEXT).toBe('Running the check. This can take up to a minute.');
    for (const text of [VERIFY_LABEL, VERIFY_HELP_TEXT, VERIFY_PENDING_TEXT]) {
      expect(containsForbiddenTerm(text)).toBe(false);
      // The numbers of the verification limit belong to 08-live-verification-api.
      expect(text).not.toMatch(/\d/);
    }
  });
});

describe('R9.7 R16.10 the result sources of each route', () => {
  it('R9.7 accepts "executed" only from the verification route', () => {
    expect(isResultSource('verify', 'executed')).toBe(true);
    for (const route of ['scan', 'seance', 'reincarnate'] as const) expect(isResultSource(route, 'executed')).toBe(false);
  });

  it('R9.7 accepts "generated" and "cache" only from the model routes', () => {
    for (const source of ['generated', 'cache']) expect(isResultSource('verify', source)).toBe(false);
    for (const route of ['scan', 'seance', 'reincarnate'] as const) {
      expect(isResultSource(route, 'generated')).toBe(true);
      expect(isResultSource(route, 'cache')).toBe(true);
    }
  });

  it('R9.7 accepts "precomputed" and "stored" from every route', () => {
    for (const route of ROUTES) {
      expect(isResultSource(route, 'precomputed')).toBe(true);
      expect(isResultSource(route, 'stored')).toBe(true);
    }
  });

  it.each([
    ['seance', 'executed'],
    ['scan', 'executed'],
    ['reincarnate', 'executed'],
    ['verify', 'generated'],
    ['verify', 'cache'],
  ] as const)('R9.7 reads a success of the route %s with the source %s as UNKNOWN', (route, source) => {
    expect(parseOutcome(route, 200, null, { ok: true, source })).toEqual({
      kind: 'failure',
      failure: 'UNKNOWN',
      status: 200,
      retryAfterSeconds: null,
    });
  });

  it('R9.7 R18.7 reads only ok and source of a verify success, and ignores the reincarnation and corpse objects', () => {
    const body = {
      ok: true,
      source: 'executed',
      reincarnation: {
        id: 'r1',
        targetStack: 'TypeScript',
        pbtPassed: true,
        totalRuns: 1000,
        executionTimeMs: 12,
        verification: 'VERIFIED',
        evidence: 'LEAKED-EVIDENCE-TEXT',
      },
      corpse: { id: CORPSE_ID, status: 'RESURRECTED' },
    };
    const outcome = parseOutcome('verify', 200, null, body);
    expect(outcome).toEqual({ kind: 'success', source: 'executed' });
    expect(JSON.stringify(outcome)).not.toContain('LEAKED');
  });

  it('R9.7 reads a success only when the source belongs to the route, whatever else the body holds', () => {
    // Feature: 06-resurrection-ui, Property 5: Outcome parsing is total and does not echo
    fc.assert(
      fc.property(
        fc.constantFrom(...ROUTES),
        fc.oneof(fc.constantFrom(...ALL_SOURCES), fc.string({ maxLength: 12 })),
        fc.string({ minLength: 4, maxLength: 20 }).map((text) => `ECHO-${text}`),
        (route, source, extra) => {
          const body = { ok: true, source, evidence: extra, reincarnation: { evidence: extra }, corpse: { note: extra } };
          const outcome = parseOutcome(route, 200, null, body);
          // A `live` success needs valid result values, which this body does not have, so it is never accepted here.
          const accepted = (RESULT_SOURCES[route] as readonly string[]).includes(source) && source !== 'live';
          const echoed = JSON.stringify(outcome).includes('ECHO-');
          return !echoed && (accepted ? outcome.kind === 'success' && outcome.source === source : outcome.kind === 'failure' && outcome.failure === 'UNKNOWN');
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('R18.13 R18.14 a live sample run', () => {
  const liveBody = (reincarnation: unknown) => ({ ok: true, source: 'live', reincarnation, corpse: { id: CORPSE_ID, status: 'RESURRECTED' } });

  it('R18.14 accepts "live" only from the verification route', () => {
    expect(isResultSource('verify', 'live')).toBe(true);
    for (const route of ['scan', 'seance', 'reincarnate'] as const) expect(isResultSource(route, 'live')).toBe(false);
  });

  it('R18.14 reads the passed flag and the run count of a live success, and no text field', () => {
    const outcome = parseOutcome('verify', 200, null, liveBody({ pbtPassed: true, totalRuns: 1000, executionTimeMs: 12, evidence: 'LEAKED-EVIDENCE-TEXT' }));
    expect(outcome).toEqual({ kind: 'success', source: 'live', live: { passed: true, totalRuns: 1000 } });
    expect(JSON.stringify(outcome)).not.toContain('LEAKED');
  });

  it.each([
    ['no reincarnation object', undefined],
    ['a missing passed flag', { totalRuns: 1000 }],
    ['a text passed flag', { pbtPassed: 'true', totalRuns: 1000 }],
    ['a zero run count', { pbtPassed: true, totalRuns: 0 }],
    ['a fractional run count', { pbtPassed: true, totalRuns: 10.5 }],
    ['a text run count', { pbtPassed: false, totalRuns: '7' }],
    ['an array', [true, 1000]],
  ])('R18.14 reads a live success with %s as UNKNOWN', (_label, reincarnation) => {
    expect(parseOutcome('verify', 200, null, liveBody(reincarnation))).toEqual({ kind: 'failure', failure: 'UNKNOWN', status: 200, retryAfterSeconds: null });
  });

  it('R18.14 words the result of a live run with the exact run count and says it was not stored', () => {
    const verified = presentLiveSuccess({ passed: true, totalRuns: 1000 });
    const differed = presentLiveSuccess({ passed: false, totalRuns: 7 });
    expect(verified).toBe(
      'The live check finished. Verified behavioral equivalence across 1,000 newly generated inputs. This result is shown here only and was not stored.',
    );
    expect(differed).toBe(
      'The live check finished. The modern function differed from the legacy function after 7 newly generated inputs. This result is shown here only and was not stored.',
    );
    for (const text of [verified, differed]) expect(containsForbiddenTerm(text)).toBe(false);
  });

  it('R18.14 shows the live message in the done state of the reducer', () => {
    const state = actionReducer(
      { phase: 'pending' },
      { type: 'finish', route: 'verify', outcome: { kind: 'success', source: 'live', live: { passed: true, totalRuns: 250 } }, now: 0 },
    );
    expect(state).toEqual({ phase: 'done', message: presentLiveSuccess({ passed: true, totalRuns: 250 }) });
  });

  it('R18.13 words the sample help text with no limit value, no run count, and no forbidden term', () => {
    expect(VERIFY_SAMPLE_HELP_TEXT).toContain('is not stored');
    expect(VERIFY_SAMPLE_HELP_TEXT).not.toMatch(/\d/);
    expect(containsForbiddenTerm(VERIFY_SAMPLE_HELP_TEXT)).toBe(false);
  });
});

describe('R9.1 R18.4 R18.5 runPipeline for the verification route', () => {
  it('sends one POST to /api/verify with a body that holds only the corpse id', async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ ok: true, source: 'executed' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    expect(await runPipeline({ fetch: fakeFetch }, 'verify', CORPSE_ID)).toEqual({ kind: 'success', source: 'executed' });
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('/api/verify');
    expect(calls[0]![1].method).toBe('POST');
    expect(calls[0]![1].body).toBe(`{"corpseId":"${CORPSE_ID}"}`);
  });

  it('R18.5 waits 70,000 ms, which is longer than the 60 s server deadline', () => {
    expect(VERIFY_CLIENT_TIMEOUT_MS).toBe(70_000);
    expect(VERIFY_CLIENT_TIMEOUT_MS).toBeGreaterThan(60_000);
  });

  it('R18.5 gives CLIENT_TIMEOUT when the verification request takes too long (short override)', async () => {
    const hangs = (async (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })) as unknown as typeof fetch;
    expect(await runPipeline({ fetch: hangs, timeoutMs: 20 }, 'verify', CORPSE_ID)).toMatchObject({
      kind: 'failure',
      failure: 'CLIENT_TIMEOUT',
    });
  });
});

describe('R18.8 R10.2 success messages of the verification route', () => {
  it('words the three messages exactly', () => {
    expect(presentSuccess('verify', 'executed')).toBe('The check finished. The stored result is shown below.');
    expect(presentSuccess('verify', 'stored')).toBe('A result was already stored. Showing it.');
    expect(presentSuccess('verify', 'precomputed')).toBe('The result is precomputed. Showing it.');
  });
});

describe('R11.10 R11.11 R18.10 R18.11 failures of the verification route', () => {
  const failureOf = (code: (typeof PIPELINE_ERROR_CODES)[number], retryAfterSeconds: number | null = null) =>
    ({ kind: 'failure', failure: code, status: 503, retryAfterSeconds }) as const;

  it('R11.10 maps the five codes of 08-live-verification-api, each to its own fixed text', () => {
    const codes = ['REINCARNATION_REQUIRED', 'VERIFICATION_DISABLED', 'VERIFICATION_BUSY', 'VERIFICATION_INCONCLUSIVE', 'SANDBOX_UNAVAILABLE'] as const;
    for (const code of codes) {
      expect(PIPELINE_ERROR_CODES).toContain(code);
      const shown = presentFailure(failureOf(code), 'verify');
      expect(shown.title).toBe(FAILURE_PRESENTATIONS[code].title);
      expect(containsForbiddenTerm(shown.message)).toBe(false);
    }
  });

  it('R18.10 tells the owner that live verification is switched off and that nothing was run, without waiting', () => {
    const shown = presentFailure(failureOf('VERIFICATION_DISABLED'), 'verify');
    expect(shown.message).toBe('Live verification is switched off on this server. Nothing was run.');
    expect(shown.waitSeconds).toBeNull();
    expect(shown.signIn).toBe(false);
  });

  it('R11.11 says "verification limit" for RATE_LIMITED on this route', () => {
    expect(presentFailure(failureOf('RATE_LIMITED', 120), 'verify').message).toContain('The verification limit was reached.');
    expect(presentFailure(failureOf('RATE_LIMITED', 120), 'verify').message).not.toContain('request limit');
  });

  it('R18.11 locks the control until the VERIFICATION_BUSY wait has passed, and then enables it again', () => {
    const state = actionReducer(
      { phase: 'pending' },
      { type: 'finish', route: 'verify', outcome: failureOf('VERIFICATION_BUSY', 30), now: 10_000 },
    );
    expect(state).toMatchObject({ phase: 'failed', retryAt: 40_000 });
    expect(isLocked(state, 39_999)).toBe(true);
    expect(isLocked(state, 40_000)).toBe(false);
  });

  it('R18.11 does not lock VERIFICATION_BUSY when the Retry-After value is missing', () => {
    const state = actionReducer({ phase: 'pending' }, { type: 'finish', route: 'verify', outcome: failureOf('VERIFICATION_BUSY', null), now: 0 });
    expect(isLocked(state, 0)).toBe(false);
    expect(state.phase === 'failed' && state.presentation.message).toContain('Try again later.');
  });

  it('R18.11 reads Retry-After for VERIFICATION_BUSY from a real response header value', () => {
    expect(parseOutcome('verify', 429, '45', { ok: false, error: { code: 'VERIFICATION_BUSY' } })).toEqual({
      kind: 'failure',
      failure: 'VERIFICATION_BUSY',
      status: 429,
      retryAfterSeconds: 45,
    });
  });

  it('R18.10 enables the control again after VERIFICATION_DISABLED, so the owner can try later', () => {
    const state = actionReducer({ phase: 'pending' }, { type: 'finish', route: 'verify', outcome: failureOf('VERIFICATION_DISABLED'), now: 0 });
    expect(isLocked(state, 0)).toBe(false);
    expect(actionReducer(state, { type: 'start' })).toEqual({ phase: 'pending' });
  });
});
