// A scripted SandboxPort for the route tests. Test-only: no production module imports this file.
// It returns one queued result per call (the last one repeats) and records every LiveRequest it receives.
import type { LiveRequest, SandboxPort, SandboxResult } from '@/lib/verification/sandbox';

export class MockSandbox implements SandboxPort {
  readonly requests: LiveRequest[] = [];
  private readonly script: unknown[];

  /** `results` may hold malformed values on purpose: the route must not trust the shape of a result. */
  constructor(results: unknown[] = [passed()]) {
    this.script = [...results];
  }

  get calls(): number {
    return this.requests.length;
  }

  async run(request: LiveRequest): Promise<SandboxResult> {
    this.requests.push(request);
    const next = this.script.length > 1 ? this.script.shift() : this.script[0];
    if (next instanceof Error) throw next;
    return next as SandboxResult;
  }
}

export function passed(totalRuns = 1_000, executionTimeMs = 420): SandboxResult {
  return {
    status: 'PASSED',
    executor: 'sandbox-worker',
    totalRuns,
    seed: 7,
    executionTimeMs,
    evidence: `Verified behavioral equivalence across ${totalRuns} generated inputs (seed 7).`,
  };
}

export function failed(totalRuns = 7, executionTimeMs = 130): SandboxResult {
  return {
    status: 'FAILED',
    executor: 'sandbox-worker',
    totalRuns,
    seed: 7,
    executionTimeMs,
    counterexample: { input: '101', legacyOutcome: 'returned: 202', modernOutcome: 'returned: 0', shrunk: true },
    evidence: `Found a behavioral difference after ${totalRuns} generated inputs (seed 7).`,
  };
}

export function errored(code: string, extra: Record<string, unknown> = {}): SandboxResult {
  return { status: 'ERROR', executor: 'sandbox-worker', code, message: 'sentinel-sandbox-message-9c41', executionTimeMs: 12, ...extra } as SandboxResult;
}

export function denied(reason: string): SandboxResult {
  return errored('LIVE_EXECUTION_DENIED', { executor: 'none', reason });
}
