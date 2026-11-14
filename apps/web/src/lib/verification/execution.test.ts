import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KillSwitchState } from '@/lib/env-server';
import { decideExecution, effectiveExecution } from './execution';

afterEach(() => {
  vi.unstubAllEnvs();
});

const STATES: KillSwitchState[] = ['engaged', 'not-engaged', 'invalid'];

describe('effective execution flag', () => {
  it('R4.4 is enabled exactly for a true flag and a kill switch that is not engaged (Requirement 4)', () => {
    // Feature: 08-live-verification-api, Property 4: Kill switch and effective flag
    fc.assert(
      fc.property(fc.boolean(), fc.constantFrom(...STATES), (flag, state) => {
        const decision = decideExecution(flag, state);
        return decision.enabled === (flag && state === 'not-engaged');
      }),
      { numRuns: 200 },
    );
  });

  it('R4.3 an invalid kill switch never enables execution and names its own reason (Requirement 4)', () => {
    expect(decideExecution(true, 'invalid')).toEqual({ enabled: false, reason: 'kill-switch-invalid' });
    expect(decideExecution(false, 'invalid')).toEqual({ enabled: false, reason: 'flag-off' });
  });

  it('R4.4 the full truth table of Requirement 4', () => {
    expect(decideExecution(true, 'not-engaged')).toEqual({ enabled: true });
    expect(decideExecution(true, 'engaged')).toEqual({ enabled: false, reason: 'kill-switch' });
    expect(decideExecution(false, 'not-engaged')).toEqual({ enabled: false, reason: 'flag-off' });
    expect(decideExecution(false, 'engaged')).toEqual({ enabled: false, reason: 'flag-off' });
  });

  // One stub per test: assigning an existing variable through the Proxy of the test guard is rejected by Node.js.
  it.each(['', '0', 'false', '1', 'nonsense'])('R4.6 the shipped code is disabled when the kill switch is %j (Requirement 4)', (value) => {
    vi.stubEnv('LAZARUS_SANDBOX_KILL_SWITCH', value);
    expect(effectiveExecution()).toEqual({ enabled: false, reason: 'flag-off' });
  });

  it('R4.3 no decision holds the kill switch value (Requirement 4)', () => {
    const sentinel = 'sentinel-kill-switch-31aa';
    vi.stubEnv('LAZARUS_SANDBOX_KILL_SWITCH', sentinel);
    expect(JSON.stringify(effectiveExecution())).not.toContain(sentinel);
  });
});
