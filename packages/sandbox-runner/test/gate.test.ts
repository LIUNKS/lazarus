import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createLiveExecutionGate, type Lease } from '../src/gate/gate.ts';
import { decideLiveExecution, DEFAULT_GATE_CONFIG } from '../src/gate/policy.ts';
import type { DenialReason, GateConfig } from '../src/types.ts';

const member = (userId: string) => ({ kind: 'member', userId }) as const;
const anonymous = { kind: 'anonymous' } as const;
const enabled: GateConfig = { ...DEFAULT_GATE_CONFIG, userExecutionEnabled: true };

const config = fc.record({
  userExecutionEnabled: fc.boolean(),
  allowAnonymousSampleRuns: fc.boolean(),
  perUserConcurrency: fc.integer({ min: 1, max: 3 }),
  globalConcurrency: fc.integer({ min: 1, max: 5 }),
});
const userId = fc.constantFrom('u1', 'u2', 'u3');
const caller = fc.oneof(
  fc.constant(anonymous),
  userId.map(member),
  fc.constantFrom<unknown>({ kind: 'member', userId: '' }, { kind: 'member' }, { kind: 'admin' }, null, 'member', 5),
);
const request = fc.record(
  {
    origin: fc.constantFrom<unknown>('sample', 'user', 'USER', 'other', 5, null),
    caller,
    corpusOwnerId: fc.oneof(userId, fc.constant(null), fc.constantFrom<unknown>(5, {})),
  },
  { requiredKeys: [] },
);

// Table-driven oracle, written independently of the implementation (design, Gate section).
function oracle(raw: Record<string, unknown>, cfg: GateConfig): string {
  const c = raw.caller as { kind?: unknown; userId?: unknown } | null | undefined;
  const isAnonymous = typeof c === 'object' && c !== null && c.kind === 'anonymous';
  const isMember = typeof c === 'object' && c !== null && c.kind === 'member' && typeof c.userId === 'string' && c.userId !== '';
  const ownerOk = raw.corpusOwnerId === null || typeof raw.corpusOwnerId === 'string';
  if ((!isAnonymous && !isMember) || (raw.origin !== 'sample' && raw.origin !== 'user') || !ownerOk) return 'INVALID_REQUEST';
  if (raw.origin === 'sample') return isMember || cfg.allowAnonymousSampleRuns ? 'in-process' : 'ANONYMOUS_NOT_ALLOWED';
  if (isAnonymous) return 'AUTH_REQUIRED';
  if (!cfg.userExecutionEnabled) return 'USER_EXECUTION_DISABLED';
  return raw.corpusOwnerId === (c as { userId: string }).userId ? 'sandbox' : 'NOT_OWNER';
}

describe('live-execution policy', () => {
  it('R3.1 decides exactly as the truth table for any request and config', () => {
    // Feature: 07-sandboxed-execution, Property 3: Gate truth table
    fc.assert(
      fc.property(request, config, (raw, cfg) => {
        const decision = decideLiveExecution(raw, cfg);
        const actual = decision.allow ? decision.executor : decision.reason;
        const isAnonymous = (raw.caller as { kind?: unknown } | null)?.kind === 'anonymous';
        return (
          actual === oracle(raw, cfg) &&
          !(isAnonymous && actual === 'sandbox') &&
          !(raw.origin === 'user' && actual === 'in-process')
        );
      }),
      { numRuns: 500 },
    );
  });

  it('R3.5 the default config keeps user execution and anonymous sample runs off', () => {
    expect(DEFAULT_GATE_CONFIG).toMatchObject({ userExecutionEnabled: false, allowAnonymousSampleRuns: false, perUserConcurrency: 1, globalConcurrency: 4 });
  });

  const denials: [DenialReason, unknown, GateConfig][] = [
    ['INVALID_REQUEST', { origin: 'other', caller: member('u1'), corpusOwnerId: 'u1' }, enabled],
    ['INVALID_REQUEST', { origin: 'user', caller: { kind: 'member', userId: '' }, corpusOwnerId: 'u1' }, enabled],
    ['INVALID_REQUEST', { origin: 'user', caller: member('u1') }, enabled],
    ['INVALID_REQUEST', null, enabled],
    ['ANONYMOUS_NOT_ALLOWED', { origin: 'sample', caller: anonymous, corpusOwnerId: null }, enabled],
    ['AUTH_REQUIRED', { origin: 'user', caller: anonymous, corpusOwnerId: 'u1' }, { ...enabled, allowAnonymousSampleRuns: true }],
    ['USER_EXECUTION_DISABLED', { origin: 'user', caller: member('u1'), corpusOwnerId: 'u1' }, DEFAULT_GATE_CONFIG],
    ['NOT_OWNER', { origin: 'user', caller: member('u1'), corpusOwnerId: 'u2' }, enabled],
    ['NOT_OWNER', { origin: 'user', caller: member('u1'), corpusOwnerId: null }, enabled],
  ];
  it.each(denials)('R3.2 denies with %s for the minimal request that triggers it', (reason, raw, cfg) => {
    expect(decideLiveExecution(raw, cfg)).toEqual({ allow: false, reason });
  });

  it('R3.8 returns the first denial when several checks fail', () => {
    // Disabled execution and a foreign corpus: the earlier check wins.
    expect(decideLiveExecution({ origin: 'user', caller: member('u1'), corpusOwnerId: 'u2' }, DEFAULT_GATE_CONFIG)).toEqual({
      allow: false,
      reason: 'USER_EXECUTION_DISABLED',
    });
    // Anonymous caller on a disabled, foreign corpus.
    expect(decideLiveExecution({ origin: 'user', caller: anonymous, corpusOwnerId: 'u2' }, DEFAULT_GATE_CONFIG)).toEqual({
      allow: false,
      reason: 'AUTH_REQUIRED',
    });
  });

  it('R3.3 R3.7 allows a member sample in-process and an owned user corpus in the sandbox', () => {
    expect(decideLiveExecution({ origin: 'sample', caller: member('u1'), corpusOwnerId: null }, DEFAULT_GATE_CONFIG)).toEqual({ allow: true, executor: 'in-process' });
    expect(decideLiveExecution({ origin: 'user', caller: member('u1'), corpusOwnerId: 'u1' }, enabled)).toMatchObject({ allow: true, executor: 'sandbox' });
  });
});

describe('live-execution gate', () => {
  const owned = (id: string) => ({ origin: 'user', caller: member(id), corpusOwnerId: id });

  it('R3.11 active leases never exceed the limits and return to 0', () => {
    // Feature: 07-sandboxed-execution, Property 4: Lease conservation
    const step = fc.oneof(
      fc.record({ op: fc.constant('acquire' as const), user: userId }),
      fc.record({ op: fc.constant('release' as const), index: fc.nat({ max: 30 }) }),
    );
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 5 }), fc.array(step, { maxLength: 60 }), (perUser, global, steps) => {
        const gate = createLiveExecutionGate({ userExecutionEnabled: true, perUserConcurrency: perUser, globalConcurrency: global });
        const held: { user: string; lease: Lease; active: boolean }[] = [];
        for (const s of steps) {
          if (s.op === 'acquire') {
            const mine = held.filter((h) => h.active && h.user === s.user).length;
            const all = held.filter((h) => h.active).length;
            const result = gate.acquire(owned(s.user));
            const expected = mine >= perUser ? 'USER_CONCURRENCY_LIMIT' : all >= global ? 'GLOBAL_CONCURRENCY_LIMIT' : 'ok';
            if ((result.ok ? 'ok' : result.reason) !== expected) return false;
            if (result.ok && result.executor === 'sandbox') held.push({ user: s.user, lease: result.lease, active: true });
          } else if (held.length > 0) {
            // Releasing an already released lease (double release) must change nothing.
            const target = held[s.index % held.length]!;
            target.lease.release();
            target.active = false;
          }
          const active = held.filter((h) => h.active).length;
          if (gate.activeLeases() !== active || active > global) return false;
        }
        for (const h of held) h.lease.release();
        return gate.activeLeases() === 0;
      }),
      { numRuns: 300 },
    );
  });

  it('R3.9 denies with the user limit before the global limit', () => {
    const gate = createLiveExecutionGate({ userExecutionEnabled: true, perUserConcurrency: 1, globalConcurrency: 1 });
    expect(gate.acquire(owned('u1')).ok).toBe(true);
    expect(gate.acquire(owned('u1'))).toEqual({ ok: false, reason: 'USER_CONCURRENCY_LIMIT' });
    expect(gate.acquire(owned('u2'))).toEqual({ ok: false, reason: 'GLOBAL_CONCURRENCY_LIMIT' });
  });

  it('R3.10 a second release does nothing', () => {
    const gate = createLiveExecutionGate({ userExecutionEnabled: true, perUserConcurrency: 2, globalConcurrency: 4 });
    const first = gate.acquire(owned('u1'));
    const second = gate.acquire(owned('u1'));
    if (!first.ok || first.executor !== 'sandbox' || !second.ok) throw new Error('expected two leases');
    first.lease.release();
    first.lease.release();
    expect(gate.activeLeases()).toBe(1);
  });

  it('R3.9 a denied or in-process request takes no lease', () => {
    const gate = createLiveExecutionGate();
    expect(gate.acquire(owned('u1'))).toEqual({ ok: false, reason: 'USER_EXECUTION_DISABLED' });
    expect(gate.acquire({ origin: 'sample', caller: member('u1'), corpusOwnerId: null })).toEqual({ ok: true, executor: 'in-process' });
    expect(gate.activeLeases()).toBe(0);
  });

  it('R3.9 rejects concurrency limits that are not integers of at least 1', () => {
    for (const value of [0, -1, 1.5, NaN, '2']) {
      expect(() => createLiveExecutionGate({ perUserConcurrency: value as number })).toThrow(TypeError);
      expect(() => createLiveExecutionGate({ globalConcurrency: value as number })).toThrow(TypeError);
    }
  });
});
