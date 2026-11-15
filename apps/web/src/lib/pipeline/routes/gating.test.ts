import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkResponse, errorCodeOf } from '@/lib/testing/assert-response';
import {
  bodyFor,
  buildHarness,
  foreignCorpse,
  INVALID_CONFIG,
  makeCorpse,
  OWNED_ID,
  reincarnationRow,
  requestFor,
  SAMPLE_ID,
  sampleCorpse,
  seanceRow,
  validReincarnationOutput,
  validSeanceOutput,
  FOREIGN_ID,
  type RouteName,
} from '@/lib/testing/harness';
import { outcomeFor } from '@/lib/testing/mock-gateway';
import { quotaUnavailable, type QuotaScript } from '@/lib/testing/memory-store';
import type { ErrorCode } from '../errors';
import { handleReincarnate } from './reincarnate';
import { handleSeance } from './seance';

type Caller = 'visitor' | 'member';
type Kind = 'sample' | 'owned' | 'foreign';
type QuotaCase = 'allow' | 'deny' | 'error' | 'malformed';

interface Scenario {
  route: Exclude<RouteName, 'scan'>;
  caller: Caller;
  kind: Kind;
  seanceRow: boolean;
  cacheHit: boolean;
  eligible: boolean;
  configValid: boolean;
  quota: QuotaCase;
}

const scenarios: fc.Arbitrary<Scenario> = fc.record({
  route: fc.constantFrom('seance' as const, 'reincarnate' as const),
  caller: fc.constantFrom<Caller>('visitor', 'member'),
  kind: fc.constantFrom<Kind>('sample', 'owned', 'foreign'),
  seanceRow: fc.boolean(),
  cacheHit: fc.boolean(),
  eligible: fc.boolean(),
  configValid: fc.boolean(),
  quota: fc.constantFrom<QuotaCase>('allow', 'deny', 'error', 'malformed'),
});

const QUOTA_SCRIPT: Record<QuotaCase, QuotaScript> = {
  allow: { allowed: true },
  deny: { allowed: false, deniedBy: 'user', retryAfterSeconds: 60 },
  error: quotaUnavailable(),
  malformed: { raw: { allowed: 'yes' } },
};

/** The expected result, decided by walking the gates in the order of Requirement 4 criterion 8. Written separately from the routes. */
function expected(s: Scenario): { generates: boolean; code: ErrorCode | null; quotaCalls: number } {
  const none = { generates: false, quotaCalls: 0 };
  if (s.kind === 'sample') return { ...none, code: s.route === 'seance' && !s.seanceRow ? 'NOT_PRECOMPUTED' : s.route === 'reincarnate' && !s.seanceRow ? 'NOT_PRECOMPUTED' : null };
  if (s.caller === 'visitor') return { ...none, code: 'AUTH_REQUIRED' };
  if (s.kind === 'foreign') return { ...none, code: 'NOT_FOUND' };
  if (s.route === 'reincarnate' && !s.seanceRow) return { ...none, code: 'SEANCE_REQUIRED' };
  if (s.cacheHit) return { ...none, code: null };
  if (!s.eligible) return { ...none, code: 'SOURCE_SYNTAX_ERROR' };
  if (!s.configValid) return { ...none, code: 'LLM_NOT_CONFIGURED' };
  if (s.quota === 'deny') return { generates: false, code: 'RATE_LIMITED', quotaCalls: 1 };
  if (s.quota !== 'allow') return { generates: false, code: 'QUOTA_UNAVAILABLE', quotaCalls: 1 };
  return { generates: true, code: null, quotaCalls: 1 };
}

function build(s: Scenario) {
  const stored = (corpseId: string) => (s.route === 'seance' ? { seances: [seanceRow(corpseId)] } : { seances: [seanceRow(corpseId)], reincarnations: [reincarnationRow(corpseId)] });
  const base = s.route === 'reincarnate' ? { seances: [] as ReturnType<typeof seanceRow>[], reincarnations: [] as ReturnType<typeof reincarnationRow>[] } : { seances: [] as ReturnType<typeof seanceRow>[], reincarnations: [] };
  const rows = { ...base };
  // The sample has stored rows only when the scenario says so. An owned corpse of the reincarnate route needs its Seance row.
  if (s.kind === 'sample' && s.seanceRow) Object.assign(rows, stored(SAMPLE_ID));
  if (s.kind === 'owned') {
    if (s.route === 'reincarnate' && s.seanceRow) rows.seances.push(seanceRow(OWNED_ID));
    // A cache hit is the corpse's own stored row. The reincarnate route reaches it only when the Seance row exists.
    if (s.cacheHit) {
      if (s.route === 'seance') rows.seances.push(seanceRow(OWNED_ID));
      else rows.reincarnations.push(reincarnationRow(OWNED_ID));
    }
  }
  const owned = makeCorpse(s.eligible ? {} : { originalCode: 'var x = ;' });
  return buildHarness({
    memberId: s.caller === 'visitor' ? null : undefined,
    corpses: [owned, sampleCorpse(), foreignCorpse()],
    seances: rows.seances,
    reincarnations: rows.reincarnations,
    quota: [QUOTA_SCRIPT[s.quota]],
    config: s.configValid ? undefined : INVALID_CONFIG,
    script: [outcomeFor('ok', s.route === 'seance' ? validSeanceOutput() : validReincarnationOutput())],
  });
}

const HANDLERS = { seance: handleSeance, reincarnate: handleReincarnate };
const ID_OF: Record<Kind, string> = { sample: SAMPLE_ID, owned: OWNED_ID, foreign: FOREIGN_ID };

describe('R4 R8 generation gating and call budget (Requirements 4 and 8)', () => {
  it('R4.8 R6.6 R6.7 R6.8 R8.1 R12.1 R15.3 calls the provider only when every gate passed, with one quota call before it and at most two calls (Requirement 4)', async () => {
    // Feature: 05-llm-pipeline-api, Property 6: Generation gating and call budget
    await fc.assert(
      fc.asyncProperty(scenarios, async (s) => {
        const h = build(s);
        const result = await checkResponse(await HANDLERS[s.route](requestFor(s.route, bodyFor(ID_OF[s.kind])), h.deps));
        const want = expected(s);
        const label = JSON.stringify(s);

        // The error code of the first failing gate, or success.
        if (want.code === null) expect(result.status, label).toBe(200);
        else expect(errorCodeOf(result), label).toBe(want.code);

        // The provider is called if and only if every gate passed, and at most twice.
        expect(h.gateway.calls.length > 0, label).toBe(want.generates);
        expect(h.gateway.calls.length, label).toBeLessThanOrEqual(2);

        // The quota function is called once when every earlier gate passed, and never otherwise.
        expect(h.store.quotaCalls, label).toBe(want.quotaCalls);
        if (want.generates) {
          expect(h.timeline.indexOf('store:reserveQuota'), label).toBeLessThan(h.timeline.indexOf('provider'));
        }

        // A request that failed before or at the quota step wrote nothing.
        if (want.code !== null && (want.quotaCalls === 0 || !want.generates)) {
          expect(h.store.writes.filter((w) => w.kind !== 'corpse.status'), label).toEqual([]);
        }
        // Nothing reads the configuration before the cache and eligibility gates have passed.
        if (want.quotaCalls === 0 && s.kind !== 'owned') expect(h.counters.configReads, label).toBe(0);
      }),
      { numRuns: 200 },
    );
  });

  it('R4.8 the order of gates is session, corpse, stored row, cache, eligibility, config, quota, provider (Requirement 4)', async () => {
    const h = buildHarness({ script: [outcomeFor('ok', validSeanceOutput())] });
    await checkResponse(await handleSeance(requestFor('seance', bodyFor(OWNED_ID)), h.deps));
    const order = h.timeline.filter((event, index, all) => all.indexOf(event) === index);
    expect(order).toEqual([
      'session',
      'store:loadCorpse',
      'store:getSeance',
      'store:listHashMatches',
      'config',
      'store:reserveQuota',
      'provider',
      'store:insertSeance',
      'store:setStatus',
    ]);
  });
});
