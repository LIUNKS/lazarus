import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkResponse } from '@/lib/testing/assert-response';
import {
  buildHarness,
  FOREIGN_ID,
  foreignCorpse,
  makeCorpse,
  MISSING_ID,
  OWNED_ID,
  reincarnationRow,
  requestFor,
  SAMPLE_ID,
  sampleCorpse,
  seanceRow,
  SIBLING_ID,
  validReincarnationOutput,
  validSeanceOutput,
  type Harness,
  type RouteName,
} from '@/lib/testing/harness';
import { outcomeFor } from '@/lib/testing/mock-gateway';
import { handleReincarnate } from './reincarnate';
import { handleScan } from './scan';
import { handleSeance } from './seance';

const HANDLERS = { scan: handleScan, seance: handleSeance, reincarnate: handleReincarnate };
const routes = fc.constantFrom<RouteName>('scan', 'seance', 'reincarnate');

type Request = { raw?: string; corpseId?: string; origin?: string | null; contentType?: string | null };
const requests: fc.Arbitrary<Request> = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(OWNED_ID, SAMPLE_ID, FOREIGN_ID, MISSING_ID).map((corpseId) => ({ corpseId })) },
  { weight: 2, arbitrary: fc.string({ maxLength: 120 }).map((raw) => ({ raw })) },
  { weight: 1, arbitrary: fc.constantFrom(OWNED_ID, SAMPLE_ID).map((corpseId) => ({ corpseId, origin: 'https://evil.example' })) },
  { weight: 1, arbitrary: fc.constantFrom(OWNED_ID, SAMPLE_ID).map((corpseId) => ({ corpseId, origin: null })) },
  { weight: 1, arbitrary: fc.constantFrom(OWNED_ID, SAMPLE_ID).map((corpseId) => ({ corpseId, contentType: 'text/plain' })) },
  { weight: 1, arbitrary: fc.constantFrom(OWNED_ID, SAMPLE_ID).map((corpseId) => ({ corpseId, contentType: null })) },
);

async function send(route: RouteName, h: Harness, request: Request): Promise<void> {
  const body = request.raw !== undefined ? undefined : { corpseId: request.corpseId };
  await checkResponse(
    await HANDLERS[route](
      requestFor(route, body, {
        ...(request.raw === undefined ? {} : { raw: request.raw }),
        ...(request.origin === undefined ? {} : { origin: request.origin }),
        ...(request.contentType === undefined ? {} : { contentType: request.contentType }),
      }),
      h.deps,
    ),
  );
}

const expectNoCost = (h: Harness) => {
  expect(h.gateway.calls).toHaveLength(0);
  expect(h.counters.configReads).toBe(0);
  expect(h.counters.gatewaysCreated).toBe(0);
  expect(h.store.quotaCalls).toBe(0);
};

/** Data that would let every route generate if a bug let the caller through: scripted outputs, stored rows, a valid config. */
function fullHarness(memberId: string | null) {
  return buildHarness({
    memberId,
    corpses: [makeCorpse(), sampleCorpse(), foreignCorpse()],
    script: [outcomeFor('ok', validSeanceOutput()), outcomeFor('ok', validReincarnationOutput())],
  });
}

describe('R4 free results (Requirement 4)', () => {
  it('R4.7 R20.3 a Visitor request, whatever the body, makes no provider call, config read, quota call, or write (Requirement 4 and 20)', async () => {
    // Feature: 05-llm-pipeline-api, Property 4: Visitor and non-generating results are free
    await fc.assert(
      fc.asyncProperty(routes, requests, async (route, request) => {
        const h = fullHarness(null);
        await send(route, h, request);
        expectNoCost(h);
        expect(h.store.writes).toEqual([]);
      }),
      { numRuns: 150 },
    );
  });

  it('R4.3 R4.4 R20.3 a Visitor sees a stored sample result without cost, and nothing is written (Requirement 4)', async () => {
    // Feature: 05-llm-pipeline-api, Property 4: Visitor and non-generating results are free
    await fc.assert(
      fc.asyncProperty(routes, fc.boolean(), async (route, rejectBody) => {
        const h = buildHarness({
          memberId: null,
          corpses: [sampleCorpse()],
          seances: [seanceRow(SAMPLE_ID)],
          reincarnations: [reincarnationRow(SAMPLE_ID, { pbtPassed: true, totalRuns: 1_000 })],
        });
        await send(route, h, rejectBody ? { raw: '{"corpseId":' } : { corpseId: SAMPLE_ID });
        expectNoCost(h);
        expect(h.store.writes).toEqual([]);
        expect(h.store.calls.filter((method) => method === 'insertSeance' || method === 'insertReincarnation')).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it('R4.3 R7.8 R5.6 a Member gets stored, cache, precomputed, and scan results without a provider call, config read, or quota (Requirement 4 and 7)', async () => {
    // Feature: 05-llm-pipeline-api, Property 4: Visitor and non-generating results are free
    type Scenario = { name: string; route: RouteName; corpseId: string; build: () => Harness; source: string; writes: number };
    const scenarios: Scenario[] = [
      { name: 'seance precomputed', route: 'seance', corpseId: SAMPLE_ID, source: 'precomputed', writes: 0, build: () => buildHarness({ seances: [seanceRow(SAMPLE_ID)], script: [outcomeFor('ok', validSeanceOutput())] }) },
      { name: 'reincarnate precomputed', route: 'reincarnate', corpseId: SAMPLE_ID, source: 'precomputed', writes: 0, build: () => buildHarness({ reincarnations: [reincarnationRow(SAMPLE_ID)], script: [outcomeFor('ok', validReincarnationOutput())] }) },
      { name: 'seance stored', route: 'seance', corpseId: OWNED_ID, source: 'stored', writes: 1, build: () => buildHarness({ seances: [seanceRow(OWNED_ID)] }) },
      { name: 'reincarnate stored', route: 'reincarnate', corpseId: OWNED_ID, source: 'stored', writes: 0, build: () => buildHarness({ seances: [seanceRow(OWNED_ID)], reincarnations: [reincarnationRow(OWNED_ID)] }) },
      {
        name: 'seance cache',
        route: 'seance',
        corpseId: OWNED_ID,
        source: 'cache',
        writes: 2,
        build: () => buildHarness({ corpses: [makeCorpse({ codeHash: 'H' }), makeCorpse({ id: SIBLING_ID, codeHash: 'H' })], seances: [seanceRow(SIBLING_ID)] }),
      },
      {
        name: 'reincarnate cache',
        route: 'reincarnate',
        corpseId: OWNED_ID,
        source: 'cache',
        writes: 1,
        build: () =>
          buildHarness({
            corpses: [makeCorpse({ codeHash: 'H' }), makeCorpse({ id: SIBLING_ID, codeHash: 'H' })],
            seances: [seanceRow(OWNED_ID), seanceRow(SIBLING_ID)],
            reincarnations: [reincarnationRow(SIBLING_ID)],
          }),
      },
    ];
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...scenarios), async (scenario) => {
        const h = scenario.build();
        const result = await checkResponse(await HANDLERS[scenario.route](requestFor(scenario.route, { corpseId: scenario.corpseId }), h.deps));
        expect(result.body, scenario.name).toMatchObject({ ok: true, source: scenario.source });
        expectNoCost(h);
        // Cache copies insert one row. A stored or cache result may update the status only when the rules allow it.
        expect(h.store.writesOfKind('quota.reserve'), scenario.name).toEqual([]);
      }),
      { numRuns: 100 },
    );

    const scan = buildHarness({ memberId: null, corpses: [sampleCorpse()] });
    await send('scan', scan, { corpseId: SAMPLE_ID });
    expectNoCost(scan);
    const memberScan = buildHarness();
    await send('scan', memberScan, { corpseId: OWNED_ID });
    expectNoCost(memberScan);
    expect(memberScan.store.writes.every((w) => w.kind === 'curses.replace')).toBe(true);
  });
});
