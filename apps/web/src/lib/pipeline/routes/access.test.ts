import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkResponse, errorCodeOf, type CheckedResponse } from '@/lib/testing/assert-response';
import {
  bodyFor,
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
type Relation = 'sample' | 'owned' | 'foreign' | 'missing';
const IDS: Record<Relation, string> = { sample: SAMPLE_ID, owned: OWNED_ID, foreign: FOREIGN_ID, missing: MISSING_ID };
const relations = fc.constantFrom<Relation>('sample', 'owned', 'foreign', 'missing');
const routes = fc.constantFrom<RouteName>('scan', 'seance', 'reincarnate');

function harness(member: boolean, sampleHasRow: boolean, extra: { sessionThrows?: boolean; loadThrows?: boolean } = {}): Harness {
  const h = buildHarness({
    memberId: member ? undefined : null,
    corpses: [makeCorpse(), sampleCorpse(), foreignCorpse()],
    // The owned corpse has a stored result, so a Member's owned request is answered from the store.
    seances: [seanceRow(OWNED_ID), ...(sampleHasRow ? [seanceRow(SAMPLE_ID)] : [])],
    reincarnations: [reincarnationRow(OWNED_ID), ...(sampleHasRow ? [reincarnationRow(SAMPLE_ID)] : [])],
    script: [outcomeFor('ok', validSeanceOutput()), outcomeFor('ok', validReincarnationOutput())],
    ...(extra.sessionThrows ? { sessionThrows: true } : {}),
  });
  if (extra.loadThrows) h.store.failOn('loadCorpse');
  return h;
}
const send = async (route: RouteName, h: Harness, relation: Relation): Promise<CheckedResponse> =>
  checkResponse(await HANDLERS[route](requestFor(route, bodyFor(IDS[relation])), h.deps), ['sentinel-session-error-5a0e']);

describe('R4 corpse access resolution (Requirement 4)', () => {
  it('R4.2 R4.3 R4.4 R4.5 R4.6 gives each caller and corpse relation the documented outcome (Requirement 4)', async () => {
    // Feature: 05-llm-pipeline-api, Property 5: Corpse access resolution
    await fc.assert(
      fc.asyncProperty(routes, relations, fc.boolean(), fc.boolean(), async (route, relation, member, sampleHasRow) => {
        const h = harness(member, sampleHasRow);
        const result = await send(route, h, relation);

        if (relation === 'sample') {
          if (route === 'scan' || sampleHasRow) expect(result.body).toMatchObject({ ok: true, source: 'precomputed' });
          else {
            expect(result.status).toBe(404);
            expect(errorCodeOf(result)).toBe('NOT_PRECOMPUTED');
          }
        } else if (!member) {
          expect(result.status).toBe(401);
          expect(errorCodeOf(result)).toBe('AUTH_REQUIRED');
        } else if (relation === 'owned') {
          expect(result.status).toBe(200);
        } else {
          expect(result.status).toBe(404);
          expect(errorCodeOf(result)).toBe('NOT_FOUND');
        }
        // A caller who cannot see the corpse never costs anything.
        if (relation !== 'owned' || !member) {
          expect(h.gateway.calls).toHaveLength(0);
          expect(h.store.quotaCalls).toBe(0);
          expect(h.store.writes).toEqual([]);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('R4.5 R4.6 gives byte-identical bodies for a missing corpse and for a corpse of another user (Requirement 4)', async () => {
    // Feature: 05-llm-pipeline-api, Property 5: Corpse access resolution
    await fc.assert(
      fc.asyncProperty(routes, fc.boolean(), async (route, member) => {
        const foreign = await send(route, harness(member, true), 'foreign');
        const missing = await send(route, harness(member, true), 'missing');
        const owned = await send(route, harness(member, true), 'owned');
        expect(foreign.text).toBe(missing.text);
        expect(foreign.status).toBe(missing.status);
        if (!member) {
          // A Visitor learns nothing about an owned corpse either.
          expect(owned.text).toBe(missing.text);
          expect(owned.status).toBe(401);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('R4.9 answers INTERNAL_ERROR with no provider call, quota, or write when the session or the corpse query throws (Requirement 4)', async () => {
    // Feature: 05-llm-pipeline-api, Property 5: Corpse access resolution
    await fc.assert(
      fc.asyncProperty(routes, relations, fc.boolean(), fc.constantFrom('session', 'load'), async (route, relation, member, failure) => {
        const h = harness(member, true, failure === 'session' ? { sessionThrows: true } : { loadThrows: true });
        const result = await send(route, h, relation);
        expect(result.status).toBe(500);
        expect(errorCodeOf(result)).toBe('INTERNAL_ERROR');
        expect(h.gateway.calls).toHaveLength(0);
        expect(h.store.quotaCalls).toBe(0);
        expect(h.counters.configReads).toBe(0);
        expect(h.store.writes).toEqual([]);
        expect(h.logs).toHaveLength(1);
      }),
      { numRuns: 100 },
    );
  });

  it('R4.1 R4.2 reads the corpse through the store of the request and no other source (Requirement 4)', async () => {
    const h = harness(true, true);
    await send('seance', h, 'owned');
    expect(h.counters.sessions).toBe(1);
    expect(h.store.calls[0]).toBe('loadCorpse');
  });
});
