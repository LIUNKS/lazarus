import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkResponse, errorCodeOf } from '@/lib/testing/assert-response';
import { bodyFor, buildHarness, OWNED_ID, requestFor, reincarnationRow, seanceRow, validReincarnationOutput, validSeanceOutput, type Harness, type RouteName } from '@/lib/testing/harness';
import { outcomeFor } from '@/lib/testing/mock-gateway';
import { TARGET_STACK } from '../limits';
import { handleReincarnate } from './reincarnate';
import { handleSeance } from './seance';

type GeneratingRoute = Exclude<RouteName, 'scan'>;
const HANDLERS = { seance: handleSeance, reincarnate: handleReincarnate };
const BANNED = /100%|mathematical proof|mathematically proven|guaranteed/i;

// Free text for the model strings: any characters, except line terminators (they would end a code comment) and banned phrases.
const freeText = fc.string({ maxLength: 60 }).filter((text) => !/[\n\r\u2028\u2029]/.test(text) && !BANNED.test(text));

const send = async (route: GeneratingRoute, h: Harness) => checkResponse(await HANDLERS[route](requestFor(route, bodyFor(OWNED_ID)), h.deps));
const setup = (route: GeneratingRoute, output: unknown) =>
  buildHarness({ seances: route === 'reincarnate' ? [seanceRow(OWNED_ID)] : [], script: [outcomeFor('ok', output), outcomeFor('ok', output)] });

describe('R11 R14 persistence and conflict resolution (Requirements 11, 14, and 16)', () => {
  it('R16.5 R11.1 R14.1 stores the model strings unchanged, byte for byte, with the documented fixed columns (Requirement 16)', async () => {
    // Feature: 05-llm-pipeline-api, Property 15: Persistence and conflict resolution
    await fc.assert(
      fc.asyncProperty(freeText, async (text) => {
        const seance = { ...validSeanceOutput(), designMd: `${validSeanceOutput().designMd}\n${text}  \t` };
        const h = setup('seance', seance);
        const result = await send('seance', h);
        expect(result.body).toMatchObject({ source: 'generated', seance: { requirementsMd: seance.requirementsMd, designMd: seance.designMd, approvedAt: null } });
        const inserts = h.store.writesOfKind('seance.insert');
        expect(inserts).toHaveLength(1);
        expect(inserts[0]!.row).toEqual({ corpseId: OWNED_ID, requirementsMd: seance.requirementsMd, designMd: seance.designMd, invariantsJson: seance.invariants, approvedAt: null });
        expect(h.store.seanceOf(OWNED_ID)?.designMd).toBe(seance.designMd);

        const reincarnation = { ...validReincarnationOutput(), modernCode: `${validReincarnationOutput().modernCode}// ${text}\n` };
        const r = setup('reincarnate', reincarnation);
        const stored = await send('reincarnate', r);
        expect(stored.body).toMatchObject({ source: 'generated', reincarnation: { modernCode: reincarnation.modernCode, pbtTestCode: reincarnation.pbtTestCode, targetStack: TARGET_STACK, pbtPassed: null, totalRuns: null, executionTimeMs: null } });
        expect(r.store.writesOfKind('reincarnation.insert')[0]!.row).toEqual({
          corpseId: OWNED_ID,
          targetStack: TARGET_STACK,
          modernCode: reincarnation.modernCode,
          pbtTestCode: reincarnation.pbtTestCode,
          pbtPassed: null,
          totalRuns: null,
          executionTimeMs: null,
        });
      }),
      { numRuns: 100 },
    );
  });

  it('R11.2 R14.2 on a unique violation reads the stored row, discards the generated output, and answers 200 with source stored (Requirements 11 and 14)', async () => {
    // Feature: 05-llm-pipeline-api, Property 15: Persistence and conflict resolution
    await fc.assert(
      fc.asyncProperty(fc.constantFrom<GeneratingRoute>('seance', 'reincarnate'), freeText, async (route, winnerText) => {
        const output = route === 'seance' ? validSeanceOutput() : validReincarnationOutput();
        const h = setup(route, output);
        if (route === 'seance') h.store.beforeInsertSeance = (store) => store.addSeance(seanceRow(OWNED_ID, { id: 'winner', requirementsMd: `winner ${winnerText}` }));
        else h.store.beforeInsertReincarnation = (store) => store.addReincarnation(reincarnationRow(OWNED_ID, { id: 'winner', modernCode: `winner ${winnerText}` }));
        const result = await send(route, h);

        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({ ok: true, source: 'stored' });
        const inserts = route === 'seance' ? h.store.writesOfKind('seance.insert') : h.store.writesOfKind('reincarnation.insert');
        // Exactly one insert attempt, and it lost. No second insert follows.
        expect(inserts.map((w) => w.result)).toEqual(['conflict']);
        expect(route === 'seance' ? h.store.seanceCount : h.store.reincarnationCount).toBe(1);
        // The generated output is discarded: the response holds the winner's text and not the model's.
        const stored = result.body[route === 'seance' ? 'seance' : 'reincarnation'] as Record<string, unknown>;
        expect(stored[route === 'seance' ? 'requirementsMd' : 'modernCode']).toBe(`winner ${winnerText}`);
        if (route === 'seance') expect(stored['requirementsMd']).not.toBe(validSeanceOutput().requirementsMd);
      }),
      { numRuns: 60 },
    );
  });

  it('R11.8 two racing requests for one corpse end with one row and the same stored content in both responses (Requirement 11)', async () => {
    // Feature: 05-llm-pipeline-api, Property 15: Persistence and conflict resolution
    await fc.assert(
      fc.asyncProperty(fc.constantFrom<GeneratingRoute>('seance', 'reincarnate'), async (route) => {
        const first = route === 'seance' ? { ...validSeanceOutput(), designMd: `${validSeanceOutput().designMd} First.` } : { ...validReincarnationOutput(), modernCode: `${validReincarnationOutput().modernCode}// first\n` };
        const second = route === 'seance' ? { ...validSeanceOutput(), designMd: `${validSeanceOutput().designMd} Second.` } : { ...validReincarnationOutput(), modernCode: `${validReincarnationOutput().modernCode}// second\n` };
        const h = buildHarness({ seances: route === 'reincarnate' ? [seanceRow(OWNED_ID)] : [], script: [outcomeFor('ok', first), outcomeFor('ok', second)] });
        const [a, b] = await Promise.all([send(route, h), send(route, h)]);

        expect(a.status).toBe(200);
        expect(b.status).toBe(200);
        expect(route === 'seance' ? h.store.seanceCount : h.store.reincarnationCount).toBe(1);
        const field = route === 'seance' ? 'seance' : 'reincarnation';
        const content = (r: typeof a) => JSON.stringify((r.body[field] as Record<string, unknown>)[route === 'seance' ? 'designMd' : 'modernCode']);
        expect(content(a)).toBe(content(b));
        expect([a.body['source'], b.body['source']].sort()).toEqual(['generated', 'stored']);
      }),
      { numRuns: 40 },
    );
  });

  it('R11.3 R14.3 answers PERSISTENCE_FAILED and returns no generated output when the insert fails for another reason (Requirement 11 and 14)', async () => {
    // Feature: 05-llm-pipeline-api, Property 15: Persistence and conflict resolution
    await fc.assert(
      fc.asyncProperty(fc.constantFrom<GeneratingRoute>('seance', 'reincarnate'), async (route) => {
        const output = route === 'seance' ? validSeanceOutput() : validReincarnationOutput();
        const h = setup(route, output);
        h.store.failOn(route === 'seance' ? 'insertSeance' : 'insertReincarnation');
        const result = await send(route, h);
        expect(result.status).toBe(500);
        expect(errorCodeOf(result)).toBe('PERSISTENCE_FAILED');
        expect(result.text).not.toContain(route === 'seance' ? validSeanceOutput().designMd.slice(0, 30) : 'export function');
        expect(h.store.corpseOf(OWNED_ID)?.status).toBe('INFECTED');
        expect(h.store.writesOfKind('corpse.status')).toHaveLength(0);
      }),
      { numRuns: 20 },
    );
  });

  it('R11.7 R14.8 writes only whitelisted kinds and never updates or deletes a result row (Requirement 11 and 14)', async () => {
    // Feature: 05-llm-pipeline-api, Property 15: Persistence and conflict resolution
    await fc.assert(
      fc.asyncProperty(fc.constantFrom<GeneratingRoute>('seance', 'reincarnate'), async (route) => {
        const h = setup(route, route === 'seance' ? validSeanceOutput() : validReincarnationOutput());
        await send(route, h);
        await send(route, h);
        const allowedWrites = ['quota.reserve', 'seance.insert', 'reincarnation.insert', 'corpse.status'];
        for (const write of h.store.writes) expect(allowedWrites).toContain(write.kind);
        // The store interface has no update or delete method for result rows, and the route called none.
        for (const method of h.store.calls) expect(['update', 'delete', 'upsert']).not.toContain(method);
        // The second request found the stored row and spent no second reservation.
        expect(h.store.quotaCalls).toBe(1);
      }),
      { numRuns: 20 },
    );
  });
});
