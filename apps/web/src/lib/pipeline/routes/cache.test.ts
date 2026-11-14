import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkResponse, errorCodeOf } from '@/lib/testing/assert-response';
import {
  bodyFor,
  buildHarness,
  INVALID_CONFIG,
  makeCorpse,
  MEMBER_ID,
  OTHER_ID,
  OWNED_ID,
  reincarnationRow,
  requestFor,
  seanceRow,
  type RouteName,
} from '@/lib/testing/harness';
import type { MemoryCorpse } from '@/lib/testing/memory-store';
import type { ReincarnationRow, SeanceRow } from '../types';
import { handleReincarnate } from './reincarnate';
import { handleSeance } from './seance';

const HASH = 'shared-hash';
const at = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 1_000).toISOString();

interface Other {
  id: string;
  owner: 'member' | 'other' | 'sample';
  sameHash: boolean;
  corpseN: number;
  hasSeance: boolean;
  sameSeance: boolean;
  hasReincarnation: boolean;
  reincarnationN: number;
}

const others = fc.uniqueArray(fc.uuid(), { minLength: 0, maxLength: 6 }).chain((ids) =>
  fc.tuple(
    ...ids.map((id) =>
      fc.record<Other>({
        id: fc.constant(id),
        owner: fc.constantFrom('member', 'other', 'sample'),
        sameHash: fc.boolean(),
        corpseN: fc.integer({ min: 0, max: 8 }),
        hasSeance: fc.boolean(),
        sameSeance: fc.boolean(),
        hasReincarnation: fc.boolean(),
        reincarnationN: fc.integer({ min: 0, max: 8 }),
      }),
    ),
  ),
);

interface World {
  owned: { hasOwnRow: boolean; hash: string };
  others: Other[];
}

const worlds: fc.Arbitrary<World> = fc.record({
  owned: fc.record({ hasOwnRow: fc.boolean(), hash: fc.constantFrom(HASH, '') }),
  others,
});

const corpseOf = (o: Other): MemoryCorpse =>
  makeCorpse({
    id: o.id,
    userId: o.owner === 'sample' ? null : o.owner === 'member' ? MEMBER_ID : OTHER_ID,
    isSample: o.owner === 'sample',
    codeHash: o.sameHash ? HASH : 'another-hash',
    createdAt: at(o.corpseN),
  });
const isVisible = (o: Other) => o.owner !== 'other';
const newestFirst = (a: { n: number; id: string }, b: { n: number; id: string }) => b.n - a.n || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

const requested = seanceRow(OWNED_ID, { requirementsMd: 'requested requirements', designMd: 'requested design' });
const otherSeance = (o: Other, forReincarnate: boolean): SeanceRow =>
  seanceRow(o.id, {
    id: `seance-${o.id}`,
    requirementsMd: forReincarnate && o.sameSeance ? requested.requirementsMd : `requirements of ${o.id}`,
    designMd: forReincarnate && o.sameSeance ? requested.designMd : `design of ${o.id}`,
    invariantsJson: requested.invariantsJson,
  });
const otherReincarnation = (o: Other): ReincarnationRow => reincarnationRow(o.id, { id: `reincarnation-${o.id}`, modernCode: `code of ${o.id}`, createdAt: at(o.reincarnationN) });

const HANDLERS = { seance: handleSeance, reincarnate: handleReincarnate };
async function run(route: Extract<RouteName, 'seance' | 'reincarnate'>, world: World, configure: (h: ReturnType<typeof buildHarness>) => void = () => undefined) {
  const forReincarnate = route === 'reincarnate';
  const h = buildHarness({
    corpses: [makeCorpse({ codeHash: world.owned.hash }), ...world.others.map(corpseOf)],
    seances: [
      ...(forReincarnate ? [requested] : world.owned.hasOwnRow ? [requested] : []),
      ...world.others.filter((o) => o.hasSeance).map((o) => otherSeance(o, forReincarnate)),
    ],
    reincarnations: [...(forReincarnate && world.owned.hasOwnRow ? [reincarnationRow(OWNED_ID, { id: 'own-reincarnation' })] : []), ...world.others.filter((o) => o.hasReincarnation).map(otherReincarnation)],
    // A miss ends at the configuration gate, so a miss never inserts and never reaches quota or provider.
    config: INVALID_CONFIG,
  });
  configure(h);
  const result = await checkResponse(await HANDLERS[route](requestFor(route, bodyFor(OWNED_ID)), h.deps));
  return { h, result };
}

describe('R7 cache selection and copy (Requirement 7)', () => {
  it('R7.1 R7.2 R7.6 R7.9 picks the own row, else the newest visible row with the same hash, never a private row of another user (Requirement 7)', async () => {
    // Feature: 05-llm-pipeline-api, Property 8: Cache selection and copy
    await fc.assert(
      fc.asyncProperty(worlds, async (world) => {
        const { h, result } = await run('seance', world);
        const candidates = world.owned.hash === '' ? [] : world.others.filter((o) => isVisible(o) && o.sameHash && o.hasSeance);
        const winner = [...candidates].map((o) => ({ n: o.corpseN, id: o.id })).sort(newestFirst)[0];

        if (world.owned.hasOwnRow) {
          expect(result.body).toMatchObject({ ok: true, source: 'stored', seance: { requirementsMd: requested.requirementsMd } });
          expect(h.store.writesOfKind('seance.insert')).toHaveLength(0);
        } else if (winner !== undefined) {
          expect(result.body).toMatchObject({ ok: true, source: 'cache', seance: { requirementsMd: `requirements of ${winner.id}`, approvedAt: null } });
          const inserts = h.store.writesOfKind('seance.insert');
          expect(inserts).toHaveLength(1);
          expect(inserts[0]!.row).toMatchObject({ corpseId: OWNED_ID, requirementsMd: `requirements of ${winner.id}`, approvedAt: null });
        } else {
          // A miss inserts nothing at the cache stage and continues (here it stops at the configuration gate).
          expect(errorCodeOf(result)).toBe('LLM_NOT_CONFIGURED');
          expect(h.store.writesOfKind('seance.insert')).toHaveLength(0);
        }
        // Neither a stored row nor a cache hit costs anything.
        if (result.status === 200) {
          expect(h.gateway.calls).toHaveLength(0);
          expect(h.store.quotaCalls).toBe(0);
        }
        // The private row of another user never appears.
        const copied = h.store.seanceOf(OWNED_ID);
        for (const o of world.others.filter((x) => x.owner === 'other')) expect(copied?.requirementsMd).not.toBe(`requirements of ${o.id}`);
      }),
      { numRuns: 150 },
    );
  });

  it('R7.3 R7.4 R7.6 picks the newest visible reincarnation with the same hash and the same Seance content, and copies the six values (Requirement 7)', async () => {
    // Feature: 05-llm-pipeline-api, Property 8: Cache selection and copy
    await fc.assert(
      fc.asyncProperty(worlds, async (world) => {
        const { h, result } = await run('reincarnate', world);
        const candidates = world.owned.hash === '' ? [] : world.others.filter((o) => isVisible(o) && o.sameHash && o.hasSeance && o.sameSeance && o.hasReincarnation);
        const winner = [...candidates].map((o) => ({ n: o.reincarnationN, id: `reincarnation-${o.id}`, corpse: o.id })).sort(newestFirst)[0];

        if (world.owned.hasOwnRow) {
          expect(result.body).toMatchObject({ ok: true, source: 'stored', reincarnation: { id: 'own-reincarnation' } });
          expect(h.store.writesOfKind('reincarnation.insert')).toHaveLength(0);
        } else if (winner !== undefined) {
          expect(result.body).toMatchObject({ ok: true, source: 'cache', reincarnation: { modernCode: `code of ${winner.corpse}` } });
          const inserts = h.store.writesOfKind('reincarnation.insert');
          expect(inserts).toHaveLength(1);
          const source = otherReincarnation(world.others.find((o) => o.id === winner.corpse)!);
          expect(inserts[0]!.row).toEqual({
            corpseId: OWNED_ID,
            targetStack: source.targetStack,
            modernCode: source.modernCode,
            pbtTestCode: source.pbtTestCode,
            pbtPassed: source.pbtPassed,
            totalRuns: source.totalRuns,
            executionTimeMs: source.executionTimeMs,
          });
        } else {
          expect(errorCodeOf(result)).toBe('LLM_NOT_CONFIGURED');
          expect(h.store.writesOfKind('reincarnation.insert')).toHaveLength(0);
        }
        for (const o of world.others.filter((x) => x.owner === 'other')) expect(h.store.reincarnationOf(OWNED_ID)?.modernCode).not.toBe(`code of ${o.id}`);
      }),
      { numRuns: 150 },
    );
  });

  it('R7.7 answers PERSISTENCE_FAILED with no provider call, quota, or partial row when any cache step fails (Requirement 7)', async () => {
    // Feature: 05-llm-pipeline-api, Property 8: Cache selection and copy
    const world: World = {
      owned: { hasOwnRow: false, hash: HASH },
      others: [{ id: 'f0f0f0f0-0000-4000-8000-000000000001', owner: 'member', sameHash: true, corpseN: 3, hasSeance: true, sameSeance: true, hasReincarnation: true, reincarnationN: 2 }],
    };
    const steps = [
      ['seance', 'getSeance'],
      ['seance', 'listHashMatches'],
      ['seance', 'seancesFor'],
      ['seance', 'insertSeance'],
      ['reincarnate', 'listHashMatches'],
      ['reincarnate', 'seancesFor'],
      ['reincarnate', 'reincarnationsFor'],
      ['reincarnate', 'insertReincarnation'],
      ['reincarnate', 'getReincarnation'],
    ] as const;
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...steps), async ([route, method]) => {
        const { h, result } = await run(route, world, (harness) => harness.store.failOn(method));
        expect(result.status, `${route} ${method}`).toBe(500);
        expect(errorCodeOf(result), `${route} ${method}`).toBe('PERSISTENCE_FAILED');
        expect(h.gateway.calls).toHaveLength(0);
        expect(h.store.quotaCalls).toBe(0);
        // No partial row. The reincarnate route starts with the Seance row it requires, and that row is not touched.
        if (route === 'seance') expect(h.store.seanceOf(OWNED_ID)).toBeUndefined();
        else expect(h.store.seanceOf(OWNED_ID)).toEqual(requested);
        expect(h.store.reincarnationOf(OWNED_ID)).toBeUndefined();
        expect(h.store.writes).toEqual([]);
        expect(h.store.writesOfKind('corpse.status')).toHaveLength(0);
      }),
      { numRuns: 60 },
    );
  });

  it('R7.5 ignores any hash sent by the client and uses only the stored code_hash (Requirement 7)', async () => {
    const world: World = { owned: { hasOwnRow: false, hash: HASH }, others: [] };
    const { h } = await run('seance', world);
    const response = await checkResponse(
      await handleSeance(requestFor('seance', { corpseId: OWNED_ID, codeHash: 'other-hash' }), h.deps),
    );
    expect(response.status).toBe(400);
    expect(errorCodeOf(response)).toBe('INVALID_REQUEST');
  });
});
