import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { statusArb } from '@/lib/testing/arbitraries';
import { checkResponse } from '@/lib/testing/assert-response';
import {
  bodyFor,
  buildHarness,
  makeCorpse,
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
import type { CorpseStatus } from '../types';
import { handleReincarnate } from './reincarnate';
import { handleScan } from './scan';
import { handleSeance } from './seance';

// The documented response schemas, written separately from present.ts. Strict: no extra key is allowed.
const status = z.enum(['INFECTED', 'IN_SEANCE', 'RESURRECTED', 'FAILED']);
const corpse = z.object({ id: z.string(), status }).strict();
const invariants = z.object({ entry_function: z.string(), input: z.string(), output: z.string(), invariants: z.array(z.string()) }).strict();
const SeanceSchema = z
  .object({
    ok: z.literal(true),
    source: z.enum(['precomputed', 'stored', 'cache', 'generated']),
    seance: z.object({ id: z.string(), requirementsMd: z.string(), designMd: z.string(), invariants, approvedAt: z.string().nullable() }).strict(),
    corpse,
  })
  .strict();
const ReincarnationSchema = z
  .object({
    ok: z.literal(true),
    source: z.enum(['precomputed', 'stored', 'cache', 'generated']),
    reincarnation: z
      .object({
        id: z.string(),
        targetStack: z.string(),
        modernCode: z.string(),
        pbtTestCode: z.string(),
        pbtPassed: z.boolean().nullable(),
        totalRuns: z.number().int().nullable(),
        executionTimeMs: z.number().int().nullable(),
        createdAt: z.string(),
        verification: z.enum(['VERIFIED', 'FAILED', 'NOT_RUN']),
        evidence: z.string().nullable(),
      })
      .strict(),
    corpse,
  })
  .strict();
const ScanSchema = z
  .object({
    ok: z.literal(true),
    source: z.enum(['precomputed', 'generated']),
    lineCount: z.number().int().min(1),
    curses: z.array(z.object({ curseType: z.string(), severity: z.string(), lineNumber: z.number().int(), description: z.string(), exorcismStrategy: z.string() }).strict()),
  })
  .strict();

type Source = 'precomputed' | 'stored' | 'cache' | 'generated';
const sources = fc.constantFrom<Source>('precomputed', 'stored', 'cache', 'generated');
const passed = fc.constantFrom<boolean | null>(true, false, null);
const runs = fc.constantFrom<number | null>(null, 0, 999, 1_000, 123_456);

function build(route: Exclude<RouteName, 'scan'>, source: Source, current: CorpseStatus, pbtPassed: boolean | null, totalRuns: number | null): { h: Harness; corpseId: string } {
  const corpses = [makeCorpse({ status: current, codeHash: 'H' }), makeCorpse({ id: SIBLING_ID, codeHash: 'H' }), sampleCorpse({ status: current })];
  const row = (corpseId: string) => reincarnationRow(corpseId, { pbtPassed, totalRuns });
  const corpseId = source === 'precomputed' ? SAMPLE_ID : OWNED_ID;
  if (route === 'seance') {
    const seances = source === 'precomputed' ? [seanceRow(SAMPLE_ID)] : source === 'stored' ? [seanceRow(OWNED_ID)] : source === 'cache' ? [seanceRow(SIBLING_ID)] : [];
    return { h: buildHarness({ corpses, seances, script: [outcomeFor('ok', validSeanceOutput())] }), corpseId };
  }
  const reincarnations = source === 'precomputed' ? [row(SAMPLE_ID)] : source === 'stored' ? [row(OWNED_ID)] : source === 'cache' ? [row(SIBLING_ID)] : [];
  return { h: buildHarness({ corpses, seances: [seanceRow(OWNED_ID), seanceRow(SIBLING_ID), seanceRow(SAMPLE_ID)], reincarnations, script: [outcomeFor('ok', validReincarnationOutput())] }), corpseId };
}

describe('R3 success response shape (Requirement 3, 9, and 12)', () => {
  it('R3.6 R9.5 R9.6 every successful Seance response matches the documented shape, with a four-key invariants document (Requirement 9)', async () => {
    // Feature: 05-llm-pipeline-api, Property 21: Success response shape
    await fc.assert(
      fc.asyncProperty(sources, statusArb, async (source, current) => {
        const { h, corpseId } = build('seance', source, current, null, null);
        const result = await checkResponse(await handleSeance(requestFor('seance', bodyFor(corpseId)), h.deps));
        expect(result.status).toBe(200);
        const parsed = SeanceSchema.parse(result.body);
        expect(parsed.source).toBe(source);
        expect(Object.keys(parsed.seance.invariants).sort()).toEqual(['entry_function', 'input', 'invariants', 'output']);
      }),
      { numRuns: 100 },
    );
  });

  it('R3.6 R12.5 every successful reincarnation response matches the documented shape, whatever the stored run (Requirement 12)', async () => {
    // Feature: 05-llm-pipeline-api, Property 21: Success response shape
    await fc.assert(
      fc.asyncProperty(sources, statusArb, passed, runs, async (source, current, pbtPassed, totalRuns) => {
        const { h, corpseId } = build('reincarnate', source, current, pbtPassed, totalRuns);
        const result = await checkResponse(await handleReincarnate(requestFor('reincarnate', bodyFor(corpseId)), h.deps));
        expect(result.status).toBe(200);
        const parsed = ReincarnationSchema.parse(result.body);
        expect(parsed.source).toBe(source);
        // A generated row is always unverified.
        if (source === 'generated') expect(parsed.reincarnation).toMatchObject({ verification: 'NOT_RUN', evidence: null, pbtPassed: null });
      }),
      { numRuns: 100 },
    );
  });

  it('R3.6 R5.3 every successful scan response matches the documented shape and uses only the precomputed or generated source (Requirement 3)', async () => {
    // Feature: 05-llm-pipeline-api, Property 21: Success response shape
    const code = fc.constantFrom('var a = 1;\n', "eval('1');\nvar b = 2;\n", 'function f(x) { return x == null; }\n', '');
    await fc.assert(
      fc.asyncProperty(code, fc.boolean(), async (originalCode, sample) => {
        const h = buildHarness({ corpses: [makeCorpse({ originalCode }), sampleCorpse({ originalCode })] });
        const result = await checkResponse(await handleScan(requestFor('scan', bodyFor(sample ? SAMPLE_ID : OWNED_ID)), h.deps));
        expect(result.status).toBe(200);
        expect(ScanSchema.parse(result.body).source).toBe(sample ? 'precomputed' : 'generated');
      }),
      { numRuns: 60 },
    );
  });

  it('R3.6 rejects a response with an extra key or a wrong source, so the schemas above can fail (Requirement 3)', () => {
    expect(() => ScanSchema.parse({ ok: true, source: 'cache', lineCount: 1, curses: [] })).toThrow();
    expect(() => SeanceSchema.parse({ ok: true, source: 'stored', extra: 1 })).toThrow();
  });
});
