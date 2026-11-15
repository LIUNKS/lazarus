import { LIMITS } from './limits.js';

export class ScanAbort extends Error {
  readonly code = 'TIMEOUT' as const;
}

export interface Deadline {
  /** Throws ScanAbort when the budget has elapsed. */
  check(): void;
  /** Counts one unit of work and checks the clock every 256 units. */
  step(): void;
}

export interface DeadlineOptions {
  now?: () => number;
  timeBudgetMs?: number;
}

export function createDeadline(options: DeadlineOptions = {}): Deadline {
  const now = options.now ?? Date.now;
  const limit = now() + (options.timeBudgetMs ?? LIMITS.timeBudgetMs);
  let counter = 0;

  const check = (): void => {
    if (now() > limit) throw new ScanAbort('Scan time budget exceeded');
  };

  return {
    check,
    step(): void {
      counter = (counter + 1) & 255;
      if (counter === 0) check();
    },
  };
}
