import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { statusArb } from '@/lib/testing/arbitraries';
import { checkResponse } from '@/lib/testing/assert-response';
import {
  bodyFor,
  buildHarness,
  makeCorpse,
  OWNED_ID,
  reincarnationRow,
  requestFor,
  sampleCorpse,
  SAMPLE_ID,
  seanceRow,
  SIBLING_ID,
  validReincarnationOutput,
  validSeanceOutput,
} from '@/lib/testing/harness';
import { outcomeFor } from '@/lib/testing/mock-gateway';
import type { CorpseStatus } from '../types';
import { handleReincarnate } from './reincarnate';
import { handleSeance } from './seance';

type Source = 'precomputed' | 'stored' | 'cache' | 'generated';
const sources = fc.constantFrom<Source>('precomputed', 'stored', 'cache', 'generated');
const passed = fc.constantFrom<boolean | null>(true, false, null);

/** A harness whose request ends with the given source. The sample corpse carries its own fixed status. */
function seanceHarness(source: Source, status: CorpseStatus) {
  return buildHarness({
    corpses: [makeCorpse({ status, codeHash: 'H' }), makeCorpse({ id: SIBLING_ID, codeHash: 'H' }), sampleCorpse({ status })],
    seances: source === 'precomputed' ? [seanceRow(SAMPLE_ID)] : source === 'stored' ? [seanceRow(OWNED_ID)] : source === 'cache' ? [seanceRow(SIBLING_ID)] : [],
    script: [outcomeFor('ok', validSeanceOutput())],
  });
}
const seanceId = (source: Source) => (source === 'precomputed' ? SAMPLE_ID : OWNED_ID);

function reincarnationHarness(source: Source, status: CorpseStatus, pbtPassed: boolean | null) {
  const row = (corpseId: string) => reincarnationRow(corpseId, { pbtPassed, totalRuns: pbtPassed === null ? null : 1_000 });
  return buildHarness({
    corpses: [makeCorpse({ status, codeHash: 'H' }), makeCorpse({ id: SIBLING_ID, codeHash: 'H' }), sampleCorpse({ status })],
    seances: [seanceRow(OWNED_ID), seanceRow(SIBLING_ID), seanceRow(SAMPLE_ID)],
    reincarnations: source === 'precomputed' ? [row(SAMPLE_ID)] : source === 'stored' ? [row(OWNED_ID)] : source === 'cache' ? [row(SIBLING_ID)] : [],
    script: [outcomeFor('ok', validReincarnationOutput())],
  });
}

const sendSeance = async (h: ReturnType<typeof buildHarness>, id: string) => checkResponse(await handleSeance(requestFor('seance', bodyFor(id)), h.deps));
const sendReincarnate = async (h: ReturnType<typeof buildHarness>, id: string) => checkResponse(await handleReincarnate(requestFor('reincarnate', bodyFor(id)), h.deps));

describe('R11 R14 corpse status transitions (Requirements 11 and 14)', () => {
  it('R11.4 R11.5 moves a corpse to IN_SEANCE only for a generated or cache Seance result on INFECTED, and issues no update otherwise (Requirement 11)', async () => {
    // Feature: 05-llm-pipeline-api, Property 16: Corpse status transitions
    await fc.assert(
      fc.asyncProperty(statusArb, sources, async (status, source) => {
        const h = seanceHarness(source, status);
        const result = await sendSeance(h, seanceId(source));
        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({ source });

        const changes = (source === 'cache' || source === 'generated') && status === 'INFECTED';
        const expected = changes ? 'IN_SEANCE' : status;
        expect(result.body['corpse']).toMatchObject({ status: expected });
        expect(h.store.writesOfKind('corpse.status')).toHaveLength(changes ? 1 : 0);
        // Nothing in this route ever produces FAILED from another status.
        if (status !== 'FAILED') expect((result.body['corpse'] as { status: string }).status).not.toBe('FAILED');
      }),
      { numRuns: 150 },
    );
  });

  it('R14.4 R14.5 R14.6 resurrects only for a passed run on a corpse that is not RESURRECTED, and never produces FAILED (Requirement 14)', async () => {
    // Feature: 05-llm-pipeline-api, Property 16: Corpse status transitions
    await fc.assert(
      fc.asyncProperty(statusArb, fc.constantFrom<Source>('stored', 'cache', 'generated'), passed, async (status, source, pbtPassed) => {
        const h = reincarnationHarness(source, status, pbtPassed);
        const result = await sendReincarnate(h, OWNED_ID);
        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({ source });

        // A generated row always has a null verification, so only stored and cache rows can carry a passed run.
        const rowPassed = source === 'generated' ? null : pbtPassed;
        const changes = rowPassed === true && status !== 'RESURRECTED';
        expect((result.body['corpse'] as { status: string }).status).toBe(changes ? 'RESURRECTED' : status);
        expect(h.store.writesOfKind('corpse.status')).toHaveLength(changes ? 1 : 0);
        if (status !== 'FAILED' || !changes) expect((result.body['corpse'] as { status: string }).status === 'FAILED').toBe(status === 'FAILED');
      }),
      { numRuns: 150 },
    );
  });

  it('R14.5 a precomputed reincarnation issues no status update, whatever its stored run (Requirement 14)', async () => {
    // Feature: 05-llm-pipeline-api, Property 16: Corpse status transitions
    await fc.assert(
      fc.asyncProperty(statusArb, passed, async (status, pbtPassed) => {
        const h = reincarnationHarness('precomputed', status, pbtPassed);
        const result = await sendReincarnate(h, SAMPLE_ID);
        expect(result.body).toMatchObject({ source: 'precomputed', corpse: { status } });
        expect(h.store.writes).toEqual([]);
      }),
      { numRuns: 60 },
    );
  });

  it('R11.6 R14.7 answers 200 with the unchanged status and exactly one log line when the update fails (Requirements 11 and 14)', async () => {
    // Feature: 05-llm-pipeline-api, Property 16: Corpse status transitions
    await fc.assert(
      fc.asyncProperty(fc.constantFrom<'seance' | 'reincarnate'>('seance', 'reincarnate'), fc.constantFrom<Source>('cache', 'generated'), async (route, source) => {
        if (route === 'seance') {
          const h = seanceHarness(source, 'INFECTED');
          h.store.failOn('setStatus');
          const result = await sendSeance(h, OWNED_ID);
          expect(result.status).toBe(200);
          expect(result.body).toMatchObject({ source, corpse: { status: 'INFECTED' } });
          expect(h.logs).toEqual([{ event: 'status_update_failed', route: 'seance', corpseId: OWNED_ID, kind: 'error' }]);
          expect(h.store.seanceCount).toBeGreaterThan(0);
        } else {
          // A cache copy of a passed run triggers the RESURRECTED update, and the update fails.
          const h = reincarnationHarness('cache', 'INFECTED', true);
          h.store.failOn('setStatus');
          const result = await sendReincarnate(h, OWNED_ID);
          expect(result.status).toBe(200);
          expect(result.body).toMatchObject({ source: 'cache', corpse: { status: 'INFECTED' } });
          expect(h.logs).toEqual([{ event: 'status_update_failed', route: 'reincarnate', corpseId: OWNED_ID, kind: 'error' }]);
          expect(h.store.reincarnationCount).toBeGreaterThan(0);
        }
      }),
      { numRuns: 40 },
    );
  });

  it('R14.6 never sets FAILED on any failing path, including provider failure, quota denial, and persistence failure (Requirement 14)', async () => {
    // Feature: 05-llm-pipeline-api, Property 16: Corpse status transitions
    const setups: Array<() => ReturnType<typeof buildHarness>> = [
      () => buildHarness({ seances: [seanceRow(OWNED_ID)], script: [outcomeFor('provider-error')] }),
      () => buildHarness({ seances: [seanceRow(OWNED_ID)], script: [outcomeFor('timeout')] }),
      () => buildHarness({ seances: [seanceRow(OWNED_ID)], quota: [{ allowed: false, deniedBy: 'user', retryAfterSeconds: 5 }] }),
      () => {
        const h = buildHarness({ seances: [seanceRow(OWNED_ID)], script: [outcomeFor('ok', validReincarnationOutput())] });
        h.store.failOn('insertReincarnation');
        return h;
      },
    ];
    for (const build of setups) {
      const h = build();
      await sendReincarnate(h, OWNED_ID);
      expect(h.store.corpseOf(OWNED_ID)?.status).toBe('INFECTED');
      expect(h.store.writesOfKind('corpse.status')).toHaveLength(0);
    }
  });
});
