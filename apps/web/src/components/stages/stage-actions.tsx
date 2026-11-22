'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useReducer, useRef, useState } from 'react';
import { Heartbeat } from '@/animations/heartbeat';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { INITIAL_ACTION_STATE, actionReducer, isLocked } from '@/lib/stages/action-state';
import { runPipeline, type PipelineRoute } from '@/lib/stages/pipeline-client';

const browserFetch: typeof fetch = (input, init) => fetch(input, init);

/** Slightly after the wait ends, so the clock has passed `retryAt` when the control is checked again. */
const UNLOCK_MARGIN_MS = 25;

export interface StageActionsProps {
  route: PipelineRoute;
  /** Comes from the server-rendered corpse row. It is the only data sent to the route. */
  corpseId: string;
  /** False when the stored state no longer offers the control. The component stays mounted so its message remains. */
  available: boolean;
  label: string;
  note: string;
  pendingText: string;
  /** The id of the heading of the section. Keyboard focus moves to it after a success. */
  headingId: string;
  /** The path of the corpse page, used for the sign-in link of `AUTH_REQUIRED`. */
  currentPath: string;
}

/**
 * One trigger control for one Pipeline_API route, with its pending, success, and failure messages.
 * It sends one request per activation, never renders a response body, and refreshes the page once on success so the
 * stored rows stay the single source of truth.
 */
export function StageActions({ route, corpseId, available, label, note, pendingText, headingId, currentPath }: StageActionsProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(actionReducer, INITIAL_ACTION_STATE);
  // The clock is state, so rendering stays pure. It changes when a request ends and when a wait is over.
  const [now, setNow] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);
  // Set at once on click, before React renders again, so a second click in the same tick cannot send a second request.
  const busyRef = useRef(false);

  // Abort a pending request when the component unmounts. Its late result is then ignored.
  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  // One timer for an active wait (`RATE_LIMITED` or `VERIFICATION_BUSY` with a valid `Retry-After`).
  useEffect(() => {
    if (state.phase !== 'failed' || state.retryAt === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, state.retryAt - Date.now()) + UNLOCK_MARGIN_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const pending = state.phase === 'pending';
  const locked = isLocked(state, now);

  async function activate(): Promise<void> {
    if (busyRef.current || isLocked(state, Date.now())) return;
    busyRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    dispatch({ type: 'start' });
    const outcome = await runPipeline({ fetch: browserFetch }, route, corpseId, controller.signal);
    busyRef.current = false;
    if (controller.signal.aborted) return; // unmounted: update nothing
    const finishedAt = Date.now();
    setNow(finishedAt);
    dispatch({ type: 'finish', route, outcome, now: finishedAt });
    if (outcome.kind === 'success') {
      // A live sample run stores nothing, so there is no new row to load. Its result is in the message.
      if (outcome.source !== 'live') router.refresh();
      document.getElementById(headingId)?.focus();
    }
  }

  return (
    <div data-stage-actions className="space-y-3">
      {available ? (
        <div className="space-y-2">
          <Button type="button" onClick={() => void activate()} disabled={locked} aria-busy={pending}>
            {label}
          </Button>
          <p className="text-xs text-muted-foreground">{note}</p>
        </div>
      ) : null}
      {state.phase === 'pending' ? (
        <Notice>
          <p>{pendingText}</p>
          {/* Indeterminate on purpose: the routes return one JSON document, so there is no progress value to show. */}
          <Heartbeat className="mt-2" />
        </Notice>
      ) : null}
      {state.phase === 'done' ? <Notice>{state.message}</Notice> : null}
      {state.phase === 'failed' ? (
        <Notice tone="curse" title={state.presentation.title}>
          <p>{state.presentation.message}</p>
          {state.presentation.signIn ? (
            <p className="mt-1">
              <a href={`/sign-in?next=${encodeURIComponent(currentPath)}`} className="underline underline-offset-4">
                Sign in
              </a>
            </p>
          ) : null}
        </Notice>
      ) : null}
    </div>
  );
}
