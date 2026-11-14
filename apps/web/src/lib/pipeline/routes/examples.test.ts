// Example tests for the required scenarios of Requirement 20 criteria 4, 7, and 8, plus the configuration rules of
// Requirement 2. Every response goes through checkResponse, which asserts the closed status and code list and that
// no body holds a sentinel.
import { describe, expect, it } from 'vitest';
import { checkResponse, errorCodeOf, type CheckedResponse } from '@/lib/testing/assert-response';
import {
  API_KEY_SENTINEL,
  bodyFor,
  buildHarness,
  foreignCorpse,
  INVALID_CONFIG,
  makeCorpse,
  MEMBER_ID,
  OWNED_ID,
  requestFor,
  reincarnationRow,
  SAMPLE_ID,
  sampleCorpse,
  seanceRow,
  SIBLING_ID,
  validReincarnationOutput,
  validSeanceOutput,
  type Harness,
  type HarnessOptions,
  type RouteName,
} from '@/lib/testing/harness';
import { outcomeFor } from '@/lib/testing/mock-gateway';
import { handleReincarnate } from './reincarnate';
import { handleScan } from './scan';
import { handleSeance } from './seance';

const HANDLERS = { scan: handleScan, seance: handleSeance, reincarnate: handleReincarnate };
const SENTINELS = [API_KEY_SENTINEL, 'sentinel-session-error-5a0e'];

async function call(route: RouteName, harness: Harness, corpseId = OWNED_ID, overrides: Parameters<typeof requestFor>[2] = {}): Promise<CheckedResponse> {
  return checkResponse(await HANDLERS[route](requestFor(route, bodyFor(corpseId), overrides), harness.deps), SENTINELS);
}
const hasNoCost = (h: Harness) => {
  expect(h.gateway.calls).toHaveLength(0);
  expect(h.counters.configReads).toBe(0);
  expect(h.store.quotaCalls).toBe(0);
};
const okSeance = () => outcomeFor('ok', validSeanceOutput());
const okReincarnation = () => outcomeFor('ok', validReincarnationOutput());
const brokenSeance = () => outcomeFor('ok', { ...validSeanceOutput(), requirementsMd: 'too short' });

const SEANCE_OPTIONS: HarnessOptions = { script: [okSeance()] };
const REINCARNATE_OPTIONS = (extra: HarnessOptions = {}): HarnessOptions => ({
  seances: [seanceRow(OWNED_ID)],
  script: [okReincarnation()],
  ...extra,
});

describe('R20.7 cache order (Requirement 7 and 20)', () => {
  it('R7.1 returns the own row first, with no config read, provider call, quota, or write (Requirement 7)', async () => {
    const h = buildHarness({ seances: [seanceRow(OWNED_ID, { id: 'own-row' })] });
    const result = await call('seance', h);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, source: 'stored', seance: { id: 'own-row' }, corpse: { id: OWNED_ID, status: 'INFECTED' } });
    hasNoCost(h);
    expect(h.store.writes).toEqual([]);
  });

  it('R7.1 R7.2 copies the newest visible row with the same code_hash when the corpse has none, and leaves approved_at null (Requirement 7)', async () => {
    const h = buildHarness({
      corpses: [makeCorpse({ codeHash: 'H' }), makeCorpse({ id: SIBLING_ID, codeHash: 'H', createdAt: '2026-05-01T00:00:00.000Z' }), foreignCorpse({ codeHash: 'H' })],
      seances: [seanceRow(SIBLING_ID, { id: 'sibling-row', approvedAt: '2026-05-02T00:00:00Z' }), seanceRow('cccccccc-cccc-4ccc-8ccc-cccccccccccc', { id: 'foreign-row' })],
    });
    const result = await call('seance', h);
    expect(result.body).toMatchObject({ ok: true, source: 'cache', seance: { approvedAt: null } });
    hasNoCost(h);
    const inserts = h.store.writesOfKind('seance.insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.row).toMatchObject({ corpseId: OWNED_ID, approvedAt: null, requirementsMd: seanceRow(SIBLING_ID).requirementsMd });
    expect(h.store.seanceOf(OWNED_ID)?.id).not.toBe('foreign-row');
  });

  it('R7.6 R7.9 never uses the private row of another user, and a miss continues to generation without a cache insert (Requirement 7)', async () => {
    const h = buildHarness({
      ...SEANCE_OPTIONS,
      corpses: [makeCorpse({ codeHash: 'H' }), foreignCorpse({ codeHash: 'H' })],
      seances: [seanceRow('cccccccc-cccc-4ccc-8ccc-cccccccccccc', { id: 'foreign-row' })],
    });
    const result = await call('seance', h);
    expect(result.body).toMatchObject({ ok: true, source: 'generated' });
    expect(h.gateway.calls).toHaveLength(1);
    expect(h.store.writesOfKind('seance.insert')).toHaveLength(1);
    expect(h.store.writesOfKind('seance.insert')[0]!.row.requirementsMd).toBe(validSeanceOutput().requirementsMd);
  });

  it('R7.1 does not match on an empty code_hash (Requirement 7)', async () => {
    const h = buildHarness({
      ...SEANCE_OPTIONS,
      corpses: [makeCorpse({ codeHash: '' }), makeCorpse({ id: SIBLING_ID, codeHash: '' })],
      seances: [seanceRow(SIBLING_ID)],
    });
    expect((await call('seance', h)).body).toMatchObject({ source: 'generated' });
    expect(h.store.calls).not.toContain('listHashMatches');
  });

  it('R7.3 R7.4 copies a reincarnation only from a corpse with the same hash and the same Seance content, with all six values (Requirement 7)', async () => {
    const source = reincarnationRow(SIBLING_ID, { id: 'sibling-reincarnation', pbtPassed: true, totalRuns: 1_000, executionTimeMs: 420 });
    const h = buildHarness({
      corpses: [makeCorpse({ codeHash: 'H' }), makeCorpse({ id: SIBLING_ID, codeHash: 'H' })],
      seances: [seanceRow(OWNED_ID), seanceRow(SIBLING_ID)],
      reincarnations: [source],
    });
    const result = await call('reincarnate', h);
    expect(result.body).toMatchObject({ ok: true, source: 'cache' });
    hasNoCost(h);
    expect(h.store.writesOfKind('reincarnation.insert')[0]!.row).toEqual({
      corpseId: OWNED_ID,
      targetStack: source.targetStack,
      modernCode: source.modernCode,
      pbtTestCode: source.pbtTestCode,
      pbtPassed: true,
      totalRuns: 1_000,
      executionTimeMs: 420,
    });

    const different = buildHarness({
      ...REINCARNATE_OPTIONS(),
      corpses: [makeCorpse({ codeHash: 'H' }), makeCorpse({ id: SIBLING_ID, codeHash: 'H' })],
      seances: [seanceRow(OWNED_ID), seanceRow(SIBLING_ID, { designMd: 'A different design text.' })],
      reincarnations: [source],
    });
    expect((await call('reincarnate', different)).body).toMatchObject({ source: 'generated' });
  });

  it('R12.1 answers SEANCE_REQUIRED with no provider, quota, or write when the corpse has no Seance spec (Requirement 12)', async () => {
    const h = buildHarness({ script: [okReincarnation()] });
    const result = await call('reincarnate', h);
    expect(errorCodeOf(result)).toBe('SEANCE_REQUIRED');
    expect(result.status).toBe(409);
    hasNoCost(h);
    expect(h.store.writes).toEqual([]);
  });
});

describe('R20.7 unique-violation paths (Requirements 11 and 14)', () => {
  it('R11.2 returns the stored row as `stored` when another request inserted first, and discards the generated output (Requirement 11)', async () => {
    const h = buildHarness(SEANCE_OPTIONS);
    h.store.beforeInsertSeance = (store) => store.addSeance(seanceRow(OWNED_ID, { id: 'winner', requirementsMd: 'winner requirements' }));
    const result = await call('seance', h);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ source: 'stored', seance: { id: 'winner', requirementsMd: 'winner requirements' } });
    expect(h.store.writesOfKind('seance.insert').map((w) => w.result)).toEqual(['conflict']);
    expect(h.store.seanceCount).toBe(1);
  });

  it('R11.3 answers PERSISTENCE_FAILED when the conflicting row cannot be read back (Requirement 11)', async () => {
    const h = buildHarness(SEANCE_OPTIONS);
    h.store.beforeInsertSeance = (store) => {
      store.addSeance(seanceRow(OWNED_ID));
      store.failOn('getSeance');
    };
    expect(errorCodeOf(await call('seance', h))).toBe('PERSISTENCE_FAILED');
    expect(h.store.corpseOf(OWNED_ID)?.status).toBe('INFECTED');
  });

  it('R14.2 returns the stored reincarnation as `stored` when another request inserted first (Requirement 14)', async () => {
    const h = buildHarness(REINCARNATE_OPTIONS());
    h.store.beforeInsertReincarnation = (store) => store.addReincarnation(reincarnationRow(OWNED_ID, { id: 'winner', modernCode: 'export const winner = 1;' }));
    const result = await call('reincarnate', h);
    expect(result.body).toMatchObject({ source: 'stored', reincarnation: { id: 'winner', modernCode: 'export const winner = 1;' } });
    expect(h.store.reincarnationCount).toBe(1);
  });
});

describe('R20.7 status transitions (Requirements 11 and 14)', () => {
  it('R11.4 moves an INFECTED corpse to IN_SEANCE for a generated or cache result, and returns that status (Requirement 11)', async () => {
    const h = buildHarness(SEANCE_OPTIONS);
    expect((await call('seance', h)).body).toMatchObject({ source: 'generated', corpse: { status: 'IN_SEANCE' } });
    expect(h.store.corpseOf(OWNED_ID)?.status).toBe('IN_SEANCE');
  });

  it('R11.5 leaves IN_SEANCE, RESURRECTED, and FAILED unchanged and issues no update, even for a stored row (Requirement 11)', async () => {
    for (const status of ['IN_SEANCE', 'RESURRECTED', 'FAILED'] as const) {
      const h = buildHarness({ corpses: [makeCorpse({ status })], seances: [seanceRow(OWNED_ID)] });
      expect((await call('seance', h)).body).toMatchObject({ source: 'stored', corpse: { status } });
      expect(h.store.writesOfKind('corpse.status')).toHaveLength(0);
    }
    const stored = buildHarness({ seances: [seanceRow(OWNED_ID)] });
    expect((await call('seance', stored)).body).toMatchObject({ source: 'stored', corpse: { status: 'INFECTED' } });
    expect(stored.store.writesOfKind('corpse.status')).toHaveLength(0);
  });

  it('R11.6 answers 200 with the unchanged status and logs once when the status update fails (Requirement 11)', async () => {
    const h = buildHarness(SEANCE_OPTIONS);
    h.store.failOn('setStatus');
    const result = await call('seance', h);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ source: 'generated', corpse: { status: 'INFECTED' } });
    expect(h.logs).toEqual([{ event: 'status_update_failed', route: 'seance', corpseId: OWNED_ID, kind: 'error' }]);
    expect(h.store.seanceCount).toBe(1);
  });

  it('R14.4 R14.5 R14.6 resurrects only for a passed run, and never sets FAILED (Requirement 14)', async () => {
    const passed = buildHarness({ seances: [seanceRow(OWNED_ID)], reincarnations: [reincarnationRow(OWNED_ID, { pbtPassed: true, totalRuns: 1_000 })] });
    const result = await call('reincarnate', passed);
    expect(result.body).toMatchObject({ source: 'stored', corpse: { status: 'RESURRECTED' }, reincarnation: { verification: 'VERIFIED', evidence: 'Verified behavioral equivalence across 1,000 generated inputs.' } });
    expect(passed.store.writesOfKind('corpse.status')).toHaveLength(1);

    for (const pbtPassed of [null, false]) {
      const h = buildHarness({ seances: [seanceRow(OWNED_ID)], reincarnations: [reincarnationRow(OWNED_ID, { pbtPassed })] });
      const body = (await call('reincarnate', h)).body;
      expect(body).toMatchObject({ corpse: { status: 'INFECTED' }, reincarnation: { evidence: null } });
      expect(h.store.writesOfKind('corpse.status')).toHaveLength(0);
    }
  });

  it('R12.5 R12.8 R14.1 stores a generated reincarnation with the target stack and a null verification (Requirement 12 and 14)', async () => {
    const h = buildHarness(REINCARNATE_OPTIONS());
    const result = await call('reincarnate', h);
    expect(result.body).toMatchObject({
      ok: true,
      source: 'generated',
      corpse: { status: 'INFECTED' },
      reincarnation: { targetStack: 'TypeScript (strict, ES2022)', pbtPassed: null, totalRuns: null, executionTimeMs: null, verification: 'NOT_RUN', evidence: null },
    });
    expect(h.store.writesOfKind('reincarnation.insert')[0]!.row).toMatchObject({ pbtPassed: null, totalRuns: null, executionTimeMs: null });
  });
});

describe('R20.7 repair versus fallback, at most two provider calls (Requirement 15)', () => {
  it('R10.6 repairs an invalid first output with one more call to the same target, and names only the rules (Requirement 10)', async () => {
    const h = buildHarness({ script: [brokenSeance(), okSeance()] });
    const result = await call('seance', h);
    expect(result.body).toMatchObject({ source: 'generated' });
    expect(h.gateway.calls.map((c) => c.target)).toEqual(['primary', 'primary']);
    expect(h.gateway.calls[1]!.prompt).toContain('REQUIREMENTS_FORMAT');
    expect(h.gateway.calls[1]!.prompt).not.toContain('too short');
    expect(h.store.quotaCalls).toBe(1);
  });

  it('R15.4 sends the second call to the fallback target after a provider error, when a fallback is configured (Requirement 15)', async () => {
    const h = buildHarness({ script: [outcomeFor('provider-error'), okSeance()], fallbackAvailable: true });
    expect((await call('seance', h)).body).toMatchObject({ source: 'generated' });
    expect(h.gateway.calls.map((c) => c.target)).toEqual(['primary', 'fallback']);
    expect(h.store.quotaCalls).toBe(1);
  });

  it('R15.5 R15.6 answers 502 for a provider error and 504 for a timeout when no fallback is configured, with one call (Requirement 15)', async () => {
    const providerError = buildHarness({ script: [outcomeFor('provider-error')] });
    expect(errorCodeOf(await call('seance', providerError))).toBe('LLM_PROVIDER_ERROR');
    expect(providerError.gateway.calls).toHaveLength(1);
    const timeout = buildHarness({ script: [outcomeFor('timeout')] });
    expect(errorCodeOf(await call('seance', timeout))).toBe('LLM_TIMEOUT');
  });

  it('R15.3 never makes a third call, and a second invalid output gives LLM_OUTPUT_INVALID with nothing stored (Requirement 15)', async () => {
    const h = buildHarness({ script: [brokenSeance(), brokenSeance(), okSeance()] });
    const result = await call('seance', h);
    expect(errorCodeOf(result)).toBe('LLM_OUTPUT_INVALID');
    expect(h.gateway.calls).toHaveLength(2);
    expect(h.store.writes).toEqual([{ kind: 'quota.reserve', route: 'seance' }]);
    expect(result.text).not.toContain('too short');
  });

  it('R15.8 answers LLM_NOT_CONFIGURED for a 401 or 403 and makes no second call (Requirement 15)', async () => {
    const h = buildHarness({ script: [outcomeFor('auth'), okSeance()], fallbackAvailable: true });
    const result = await call('seance', h);
    expect(errorCodeOf(result)).toBe('LLM_NOT_CONFIGURED');
    expect(result.status).toBe(503);
    expect(h.gateway.calls).toHaveLength(1);
  });

  it('R13.11 R13.12 repairs a reincarnation that fails the static gate once, then rejects a second failure with nothing stored (Requirement 13)', async () => {
    const bad = outcomeFor('ok', { ...validReincarnationOutput(), modernCode: 'export function calc(a: number, b: number): number {\n  var sum = a + b;\n  return sum;\n}\n' });
    const repaired = buildHarness(REINCARNATE_OPTIONS({ script: [bad, okReincarnation()] }));
    expect((await call('reincarnate', repaired)).body).toMatchObject({ source: 'generated' });
    expect(repaired.gateway.calls[1]!.prompt).toContain('MODERN_FORBIDDEN_CONSTRUCTS');

    const rejected = buildHarness(REINCARNATE_OPTIONS({ script: [bad, bad] }));
    const result = await call('reincarnate', rejected);
    expect(errorCodeOf(result)).toBe('LLM_OUTPUT_INVALID');
    expect(rejected.store.writes).toEqual([{ kind: 'quota.reserve', route: 'reincarnate' }]);
    expect(result.text).not.toContain('var sum');
  });
});

describe('R20.4 rejected bodies (Requirement 20)', () => {
  const cases: Array<[string, RouteName, Parameters<typeof requestFor>[2] & { body?: unknown }, number, string]> = [
    ['a missing corpseId key', 'seance', { raw: '{}' }, 400, 'INVALID_REQUEST'],
    ['an extra key', 'reincarnate', { raw: JSON.stringify({ corpseId: OWNED_ID, extra: 1 }) }, 400, 'INVALID_REQUEST'],
    ['a value that is not a UUID', 'scan', { raw: JSON.stringify({ corpseId: 'nope' }) }, 400, 'INVALID_REQUEST'],
    ['a JSON array body', 'seance', { raw: JSON.stringify([{ corpseId: OWNED_ID }]) }, 400, 'INVALID_REQUEST'],
    ['a body of 1,025 bytes', 'seance', { raw: `${JSON.stringify({ corpseId: OWNED_ID })}${' '.repeat(1_025 - JSON.stringify({ corpseId: OWNED_ID }).length)}` }, 413, 'REQUEST_TOO_LARGE'],
    ['a wrong content type', 'reincarnate', { contentType: 'text/plain' }, 415, 'UNSUPPORTED_MEDIA_TYPE'],
    ['a missing Origin', 'scan', { origin: null }, 403, 'FORBIDDEN_ORIGIN'],
    ['a different Origin', 'seance', { origin: 'https://evil.example' }, 403, 'FORBIDDEN_ORIGIN'],
  ];

  it.each(cases)('R3.2 R3.3 R3.4 R3.5 rejects %s with the right code, no provider call, and no write (Requirement 3)', async (_label, route, overrides, status, code) => {
    for (const memberId of [MEMBER_ID, null]) {
      const h = buildHarness({ memberId, corpses: [makeCorpse(), sampleCorpse()], script: [okSeance()] });
      const result = await call(route, h, OWNED_ID, overrides);
      expect(result.status).toBe(status);
      expect(errorCodeOf(result)).toBe(code);
      hasNoCost(h);
      expect(h.store.writes).toEqual([]);
      expect(h.counters.sessions).toBe(0);
      expect(h.logs).toHaveLength(1);
      expect(h.logs[0]).toMatchObject({ event: 'pipeline_error', route, code, corpseId: null });
    }
  });

  it('R3.4 accepts a body of exactly 1,024 bytes (Requirement 3)', async () => {
    const base = JSON.stringify({ corpseId: OWNED_ID });
    const h = buildHarness({ seances: [seanceRow(OWNED_ID)] });
    const result = await call('seance', h, OWNED_ID, { raw: base + ' '.repeat(1_024 - base.length) });
    expect(result.status).toBe(200);
  });
});

describe('R2.5 R2.6 configuration (Requirement 2)', () => {
  it('R2.6 answers LLM_NOT_CONFIGURED with no quota, provider, or write, and names no variable (Requirement 2)', async () => {
    for (const route of ['seance', 'reincarnate'] as const) {
      // The Seance route needs no stored row. The reincarnate route needs one, or it answers SEANCE_REQUIRED first.
      const h = buildHarness({ ...(route === 'seance' ? SEANCE_OPTIONS : REINCARNATE_OPTIONS()), config: INVALID_CONFIG });
      const result = await call(route, h);
      expect(result.status).toBe(503);
      expect(errorCodeOf(result)).toBe('LLM_NOT_CONFIGURED');
      expect(result.text).not.toMatch(/GROQ|LLM_MODEL|GOOGLE|API_KEY/);
      expect(h.store.quotaCalls).toBe(0);
      expect(h.gateway.calls).toHaveLength(0);
      expect(h.store.writes).toEqual([]);
    }
  });

  it('R2.5 serves stored, cache, precomputed, Visitor, and scan requests without reading any LLM variable (Requirement 2)', async () => {
    const stored = buildHarness({ seances: [seanceRow(OWNED_ID)], config: INVALID_CONFIG });
    expect((await call('seance', stored)).status).toBe(200);
    expect(stored.counters.configReads).toBe(0);

    const sample = buildHarness({ memberId: null, seances: [seanceRow(SAMPLE_ID)], reincarnations: [reincarnationRow(SAMPLE_ID, { pbtPassed: true, totalRuns: 1_000 })], config: INVALID_CONFIG });
    for (const route of ['seance', 'reincarnate'] as const) {
      const result = await call(route, sample, SAMPLE_ID);
      expect(result.body).toMatchObject({ source: 'precomputed' });
    }
    expect((await call('scan', sample, SAMPLE_ID)).body).toMatchObject({ source: 'precomputed', curses: [] });
    expect(sample.counters.configReads).toBe(0);
    expect(sample.store.writes).toEqual([]);

    const scan = buildHarness({ config: INVALID_CONFIG });
    expect((await call('scan', scan)).body).toMatchObject({ ok: true, source: 'generated' });
    expect(scan.counters.configReads).toBe(0);
    expect(scan.store.quotaCalls).toBe(0);
  });

  it('R4.3 R4.4 returns NOT_PRECOMPUTED for a sample without a stored row, for a Visitor and a Member (Requirement 4)', async () => {
    for (const memberId of [null, MEMBER_ID]) {
      for (const route of ['seance', 'reincarnate'] as const) {
        const h = buildHarness({ memberId });
        const result = await call(route, h, SAMPLE_ID);
        expect(result.status).toBe(404);
        expect(errorCodeOf(result)).toBe('NOT_PRECOMPUTED');
        hasNoCost(h);
      }
    }
  });
});
