import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseKillSwitch, readKillSwitch, serverConfigProblems, type KillSwitchState } from './env-server';

afterEach(() => {
  vi.unstubAllEnvs();
});

// Oracle written independently of the implementation (Requirement 4 criterion 2).
function expectedState(raw: string | undefined): KillSwitchState {
  if (raw === undefined) return 'not-engaged';
  const value = raw.replace(/^\s+|\s+$/g, '').toLowerCase();
  if (['1', 'true'].includes(value)) return 'engaged';
  if (['', '0', 'false'].includes(value)) return 'not-engaged';
  return 'invalid';
}

const padding = fc.constantFrom('', ' ', '  ', '\t', '\n', ' \t ');
const word = fc.oneof(
  fc.constantFrom('1', 'true', 'TRUE', 'True', '0', 'false', 'FALSE', 'fAlSe', '', 'yes', 'on', 'off', '2', '01', 'truee', 'enabled'),
  fc.string({ maxLength: 12 }),
);
const raw = fc.oneof(fc.constant(undefined), fc.tuple(padding, word, padding).map(([left, value, right]) => `${left}${value}${right}`));

describe('kill switch', () => {
  it('R4.2 parses every value into the three states of Requirement 4', () => {
    // Feature: 08-live-verification-api, Property 4: Kill switch and effective flag
    fc.assert(
      fc.property(raw, (value) => parseKillSwitch(value) === expectedState(value)),
      { numRuns: 200 },
    );
  });

  it('R4.2 treats the documented values as Requirement 4 states them', () => {
    expect(parseKillSwitch(undefined)).toBe('not-engaged');
    for (const value of ['1', 'true', ' TRUE ', 'True']) expect(parseKillSwitch(value), value).toBe('engaged');
    for (const value of ['', '   ', '0', 'false', ' False ']) expect(parseKillSwitch(value), value).toBe('not-engaged');
    for (const value of ['yes', 'on', '2', 'tru', '1 1']) expect(parseKillSwitch(value), value).toBe('invalid');
  });

  it('R4.3 reports an invalid value as a problem that names the variable and never holds the value (Requirement 4)', () => {
    const sentinel = 'sentinel-kill-switch-7f2c';
    vi.stubEnv('LAZARUS_SANDBOX_KILL_SWITCH', sentinel);
    expect(readKillSwitch()).toBe('invalid');
    const problems = serverConfigProblems();
    expect(problems).toEqual([{ variable: 'LAZARUS_SANDBOX_KILL_SWITCH', reason: 'invalid' }]);
    expect(JSON.stringify(problems)).not.toContain(sentinel);
  });

  // One stub per test: the test guard wraps process.env in a Proxy, and assigning a variable that already exists
  // through it is rejected by Node.js. An unset variable cannot be read here either, because the guard blocks a
  // read the test did not set; the pure parser covers that case (parseKillSwitch(undefined) is 'not-engaged').
  it.each([
    ['true', 'engaged'],
    ['0', 'not-engaged'],
  ] as const)('R4.3 reports no problem for the valid value %s (Requirement 4)', (value, state) => {
    vi.stubEnv('LAZARUS_SANDBOX_KILL_SWITCH', value);
    expect(readKillSwitch()).toBe(state);
    expect(serverConfigProblems()).toEqual([]);
  });

  it('R11.13 a read of the kill switch that the test did not set fails the test (Requirement 11)', () => {
    expect(() => readKillSwitch()).toThrow(/LAZARUS_SANDBOX_KILL_SWITCH/);
  });
});
