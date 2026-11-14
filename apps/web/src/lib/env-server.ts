import 'server-only';

// The server-side half of the environment module (Requirement 4). `lib/env.ts` is imported by client code, so
// a server-only variable cannot be read there. This is the only file of `src/` that reads the kill switch.

export type KillSwitchState = 'engaged' | 'not-engaged' | 'invalid';

/**
 * `1` or `true` engages the kill switch. Unset, empty, `0`, or `false` leaves it off. Any other value is
 * `invalid`, which every decision treats as engaged (fail closed). Trimmed and compared case-insensitively.
 */
export function parseKillSwitch(raw: string | undefined): KillSwitchState {
  if (raw === undefined) return 'not-engaged';
  const value = raw.trim().toLowerCase();
  if (value === '1' || value === 'true') return 'engaged';
  if (value === '' || value === '0' || value === 'false') return 'not-engaged';
  return 'invalid';
}

export function readKillSwitch(): KillSwitchState {
  return parseKillSwitch(process.env.LAZARUS_SANDBOX_KILL_SWITCH);
}

export interface ServerConfigProblem {
  variable: 'LAZARUS_SANDBOX_KILL_SWITCH';
  reason: 'invalid';
}

/** Problems of the server-only configuration. An entry names the variable and never holds its value. */
export function serverConfigProblems(): ServerConfigProblem[] {
  return readKillSwitch() === 'invalid' ? [{ variable: 'LAZARUS_SANDBOX_KILL_SWITCH', reason: 'invalid' }] : [];
}
