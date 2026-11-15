// The state machine of one stage control (Requirement 9 criterion 3 and Requirement 11 criterion 8). Pure module: the
// caller passes the clock in every event, so the reducer is deterministic and needs no timers.
import { presentFailure, presentSuccess, type FailurePresentation } from './errors';
import type { PipelineOutcome, PipelineRoute } from './pipeline-client';

export type ActionState =
  | { phase: 'idle' }
  | { phase: 'pending' }
  | { phase: 'done'; message: string }
  /** `retryAt` is a client-clock time in milliseconds while the control waits, otherwise null. */
  | { phase: 'failed'; presentation: FailurePresentation; retryAt: number | null };

export type ActionEvent =
  | { type: 'start' }
  | { type: 'finish'; route: PipelineRoute; outcome: PipelineOutcome; now: number }
  /** The component unmounted. Whatever arrives later is ignored. */
  | { type: 'cancel' };

export const INITIAL_ACTION_STATE: ActionState = { phase: 'idle' };

/**
 * `start` is accepted from `idle`, `done`, and `failed`, and ignored while `pending`, so two requests are never in flight.
 * `finish` is accepted only from `pending`. `cancel` always returns to `idle`.
 */
export function actionReducer(state: ActionState, event: ActionEvent): ActionState {
  switch (event.type) {
    case 'start':
      return state.phase === 'pending' ? state : { phase: 'pending' };
    case 'finish': {
      if (state.phase !== 'pending') return state;
      const { outcome, route, now } = event;
      if (outcome.kind === 'success') return { phase: 'done', message: presentSuccess(route, outcome.source) };
      const presentation = presentFailure(outcome, route);
      const retryAt = presentation.waitSeconds === null ? null : now + presentation.waitSeconds * 1000;
      return { phase: 'failed', presentation, retryAt };
    }
    case 'cancel':
      return { phase: 'idle' };
  }
}

/** True while a request is pending, or while a failed control waits for its `Retry-After` time. */
export function isLocked(state: ActionState, now: number): boolean {
  if (state.phase === 'pending') return true;
  return state.phase === 'failed' && state.retryAt !== null && state.retryAt > now;
}
