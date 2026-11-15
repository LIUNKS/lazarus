import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { INITIAL_ACTION_STATE, actionReducer, isLocked, type ActionEvent, type ActionState } from './action-state';
import { PIPELINE_ERROR_CODES, type FailureKind } from './errors';
import { PIPELINE_PATHS, RESULT_SOURCES, type PipelineOutcome, type PipelineRoute } from './pipeline-client';

const ROUTES = Object.keys(PIPELINE_PATHS) as PipelineRoute[];

const failure = (kind: FailureKind, retryAfterSeconds: number | null = null): PipelineOutcome => ({
  kind: 'failure',
  failure: kind,
  status: 500,
  retryAfterSeconds,
});

const eventArbitrary: fc.Arbitrary<ActionEvent> = fc.oneof(
  fc.constant<ActionEvent>({ type: 'start' }),
  fc.constant<ActionEvent>({ type: 'cancel' }),
  fc.record({
    type: fc.constant('finish' as const),
    route: fc.constantFrom(...ROUTES),
    now: fc.integer({ min: 0, max: 1_000_000 }),
    outcome: fc.oneof(
      fc.constantFrom(...ROUTES).chain((route) =>
        fc.constantFrom(...RESULT_SOURCES[route]).map((source): PipelineOutcome => ({ kind: 'success', source })),
      ),
      fc
        .tuple(fc.constantFrom<FailureKind>(...PIPELINE_ERROR_CODES, 'NETWORK', 'CLIENT_TIMEOUT', 'UNKNOWN'), fc.option(fc.integer({ min: 1, max: 86_400 }), { nil: null }))
        .map(([kind, wait]) => failure(kind, wait)),
    ),
  }),
);

describe('R9.3 the pending state', () => {
  it('never lets two requests be in flight, for any sequence of events', () => {
    // Feature: 06-resurrection-ui, Property 8: No double submit
    fc.assert(
      fc.property(fc.array(eventArbitrary, { maxLength: 30 }), (events) => {
        let state: ActionState = INITIAL_ACTION_STATE;
        let inFlight = 0;
        for (const event of events) {
          const before = state;
          state = actionReducer(state, event);
          if (event.type === 'start') {
            // A start while pending changes nothing, and a start from any other phase begins one request.
            if (before.phase === 'pending' ? state !== before : state.phase !== 'pending') return false;
            if (before.phase !== 'pending') inFlight += 1;
          } else if (event.type === 'finish') {
            // A finish is accepted only from pending, and is ignored otherwise.
            if (before.phase !== 'pending' ? state !== before : state.phase === 'pending') return false;
            if (before.phase === 'pending') inFlight -= 1;
          } else {
            if (state.phase !== 'idle') return false;
            if (before.phase === 'pending') inFlight -= 1;
          }
          if (inFlight < 0 || inFlight > 1 || (state.phase === 'pending') !== (inFlight === 1)) return false;
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it('R9.3 moves idle to pending on the first start and ignores a second one', () => {
    const first = actionReducer(INITIAL_ACTION_STATE, { type: 'start' });
    expect(first).toEqual({ phase: 'pending' });
    expect(actionReducer(first, { type: 'start' })).toBe(first);
  });

  it('ignores a finish that arrives in any phase but pending', () => {
    const finish: ActionEvent = { type: 'finish', route: 'scan', outcome: { kind: 'success', source: 'stored' }, now: 0 };
    expect(actionReducer(INITIAL_ACTION_STATE, finish)).toBe(INITIAL_ACTION_STATE);
    const done: ActionState = { phase: 'done', message: 'x' };
    expect(actionReducer(done, finish)).toBe(done);
  });

  it('R9.5 ignores the response that arrives after the component unmounted', () => {
    let state = actionReducer(INITIAL_ACTION_STATE, { type: 'start' });
    state = actionReducer(state, { type: 'cancel' });
    expect(state).toEqual({ phase: 'idle' });
    const late: ActionEvent = { type: 'finish', route: 'seance', outcome: { kind: 'success', source: 'generated' }, now: 5 };
    expect(actionReducer(state, late)).toBe(state);
  });

  it('R10.3 keeps the success message and lets the control start again', () => {
    const pending = actionReducer(INITIAL_ACTION_STATE, { type: 'start' });
    const done = actionReducer(pending, { type: 'finish', route: 'seance', outcome: { kind: 'success', source: 'cache' }, now: 0 });
    expect(done).toEqual({ phase: 'done', message: 'Reused a stored result for identical code. No model request was made.' });
    expect(actionReducer(done, { type: 'start' })).toEqual({ phase: 'pending' });
  });
});

describe('R11.4 R11.8 the wait lock', () => {
  const finishAt = (route: PipelineRoute, outcome: PipelineOutcome, now: number): ActionState =>
    actionReducer({ phase: 'pending' }, { type: 'finish', route, outcome, now });

  it.each(['RATE_LIMITED', 'VERIFICATION_BUSY'] as const)('locks the control for the %s wait and unlocks it afterwards', (code) => {
    const state = finishAt('verify', failure(code, 30), 1_000);
    expect(state).toMatchObject({ phase: 'failed', retryAt: 31_000 });
    expect(isLocked(state, 1_000)).toBe(true);
    expect(isLocked(state, 30_999)).toBe(true);
    expect(isLocked(state, 31_000)).toBe(false);
    expect(isLocked(state, 99_000)).toBe(false);
  });

  it.each(['RATE_LIMITED', 'VERIFICATION_BUSY'] as const)('does not lock %s without a valid wait', (code) => {
    const state = finishAt('verify', failure(code, null), 1_000);
    expect(state).toMatchObject({ phase: 'failed', retryAt: null });
    expect(isLocked(state, 1_000)).toBe(false);
  });

  it('enables the control again after every failure that has no wait', () => {
    for (const kind of [...PIPELINE_ERROR_CODES, 'NETWORK', 'CLIENT_TIMEOUT', 'UNKNOWN'] as FailureKind[]) {
      if (kind === 'RATE_LIMITED' || kind === 'VERIFICATION_BUSY') continue;
      expect(isLocked(finishAt('scan', failure(kind, 30), 0), 0)).toBe(false);
    }
  });

  it('passes the route of the finish event to the failure wording', () => {
    const onVerify = finishAt('verify', failure('RATE_LIMITED', 60), 0);
    const onSeance = finishAt('seance', failure('RATE_LIMITED', 60), 0);
    expect(onVerify.phase === 'failed' && onVerify.presentation.message).toContain('verification limit');
    expect(onSeance.phase === 'failed' && onSeance.presentation.message).toContain('request limit');
  });

  it('locks while pending, and not while idle or done', () => {
    expect(isLocked({ phase: 'pending' }, 0)).toBe(true);
    expect(isLocked({ phase: 'idle' }, 0)).toBe(false);
    expect(isLocked({ phase: 'done', message: 'x' }, 0)).toBe(false);
  });

  it('lets a start follow a failure, which is how the control is used again', () => {
    expect(actionReducer(finishAt('scan', failure('NETWORK'), 0), { type: 'start' })).toEqual({ phase: 'pending' });
  });
});
