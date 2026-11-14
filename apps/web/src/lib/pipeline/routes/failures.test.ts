import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { outcomeStepArb, type OutcomeStep } from '@/lib/testing/arbitraries';
import { checkResponse, errorCodeOf } from '@/lib/testing/assert-response';
import { bodyFor, buildHarness, LEGACY_CODE, makeCorpse, OWNED_ID, requestFor, seanceRow, validReincarnationOutput, validSeanceOutput, type RouteName } from '@/lib/testing/harness';
import { outcomeFor } from '@/lib/testing/mock-gateway';
import { ERROR_TABLE } from '../errors';
import { handleReincarnate } from './reincarnate';
import { handleSeance } from './seance';

type GeneratingRoute = Exclude<RouteName, 'scan'>;
const HANDLERS = { seance: handleSeance, reincarnate: handleReincarnate };
const REJECTED = 'REJECTED-MODEL-TEXT-3d9b';
const routes = fc.constantFrom<GeneratingRoute>('seance', 'reincarnate');

/** An output that fails its validator and carries a sentinel, so a leak into the response would show. */
function badOutput(route: GeneratingRoute, kind: 'rules' | 'phrase' | 'schema'): unknown {
  if (kind === 'schema') return { unexpected: REJECTED };
  if (route === 'seance') {
    const base = validSeanceOutput();
    return kind === 'phrase'
      ? { ...base, designMd: `${base.designMd} The result is guaranteed. ${REJECTED}` }
      : { ...base, requirementsMd: `${REJECTED} short` };
  }
  const base = validReincarnationOutput();
  return kind === 'phrase'
    ? { ...base, modernCode: `// mathematical proof ${REJECTED}\n${base.modernCode}` }
    : { ...base, modernCode: `// ${REJECTED}\nexport function calc(a: number, b: number): number {\n  var sum = a + b;\n  return sum;\n}\n` };
}
const goodOutput = (route: GeneratingRoute) => (route === 'seance' ? validSeanceOutput() : validReincarnationOutput());

function setup(route: GeneratingRoute, script: ReturnType<typeof outcomeFor>[], extra: Parameters<typeof buildHarness>[0] = {}) {
  return buildHarness({ seances: route === 'reincarnate' ? [seanceRow(OWNED_ID)] : [], script, ...extra });
}
const send = async (route: GeneratingRoute, h: ReturnType<typeof buildHarness>) => checkResponse(await HANDLERS[route](requestFor(route, bodyFor(OWNED_ID)), h.deps), [REJECTED]);

describe('R15 generation failures write nothing (Requirements 9, 10, 13, 15, and 16)', () => {
  it('R15.10 R16.7 R19.2 writes only the reservation, changes no status, and returns none of the rejected text when generation fails (Requirement 15)', async () => {
    // Feature: 05-llm-pipeline-api, Property 11: Generation failures write nothing
    await fc.assert(
      fc.asyncProperty(
        routes,
        outcomeStepArb,
        outcomeStepArb,
        fc.constantFrom('rules' as const, 'phrase' as const, 'schema' as const),
        fc.constantFrom('rules' as const, 'phrase' as const, 'schema' as const),
        fc.boolean(),
        async (route, first, second, firstBad, secondBad, fallback) => {
          const stepOutput = (step: OutcomeStep, bad: 'rules' | 'phrase' | 'schema') => outcomeFor(step, step === 'ok' ? badOutput(route, bad) : undefined);
          const h = setup(route, [stepOutput(first, firstBad), stepOutput(second, secondBad)], { fallbackAvailable: fallback });
          const result = await send(route, h);

          // Every output here is invalid, so the request must fail, with a generation error code.
          expect(result.status).toBeGreaterThanOrEqual(502);
          expect(result.status).toBeLessThanOrEqual(504);
          expect(['LLM_OUTPUT_INVALID', 'LLM_PROVIDER_ERROR', 'LLM_NOT_CONFIGURED', 'LLM_TIMEOUT']).toContain(errorCodeOf(result));
          expect(result.status).toBe(ERROR_TABLE[errorCodeOf(result)!].status);

          // The only write is the reservation. No row, no status update, no curse change.
          expect(h.store.writes).toEqual([{ kind: 'quota.reserve', route }]);
          expect(h.store.corpseOf(OWNED_ID)?.status).toBe('INFECTED');
          expect(h.store.writesOfKind('corpse.status')).toHaveLength(0);
          expect(h.store.writesOfKind('curses.replace')).toHaveLength(0);
          expect(h.store.corpseOf(OWNED_ID)?.status).not.toBe('FAILED');
          expect(h.gateway.calls.length).toBeLessThanOrEqual(2);
          expect(h.store.quotaCalls).toBe(1);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('R10.7 R13.12 R19.2 answers LLM_OUTPUT_INVALID after two outputs with a banned phrase or a broken rule, and stores nothing (Requirement 10 and 13)', async () => {
    // Feature: 05-llm-pipeline-api, Property 11: Generation failures write nothing
    await fc.assert(
      fc.asyncProperty(routes, fc.constantFrom('rules' as const, 'phrase' as const, 'schema' as const), async (route, kind) => {
        const bad = outcomeFor('ok', badOutput(route, kind));
        const h = setup(route, [bad, bad, outcomeFor('ok', goodOutput(route))]);
        const result = await send(route, h);
        expect(result.status).toBe(502);
        expect(errorCodeOf(result)).toBe('LLM_OUTPUT_INVALID');
        expect(h.gateway.calls).toHaveLength(2);
        expect(h.store.writes).toEqual([{ kind: 'quota.reserve', route }]);
        expect(result.text).not.toContain(REJECTED);
        expect(result.text).not.toMatch(/guaranteed|mathematical proof/i);
      }),
      { numRuns: 60 },
    );
  });

  it('R16.2 answers INTERNAL_ERROR with no provider call when all five delimiter candidates occur in the code (Requirement 16)', async () => {
    // Feature: 05-llm-pipeline-api, Property 11: Generation failures write nothing
    const hex = (fill: number) => new Uint8Array(16).fill(fill).reduce((text, byte) => text + byte.toString(16).padStart(2, '0'), '');
    const codeWith = (fills: number[]) => `${LEGACY_CODE}${fills.map((fill) => `// LAZARUS-UNTRUSTED-${hex(fill)}`).join('\n')}\n`;
    await fc.assert(
      fc.asyncProperty(routes, async (route) => {
        const colliding = setup(route, [outcomeFor('ok', goodOutput(route))], {
          corpses: [makeCorpse({ originalCode: codeWith([7, 7, 7, 7, 7]) })],
          randomBytes: () => new Uint8Array(16).fill(7),
        });
        const result = await send(route, colliding);
        expect(result.status).toBe(500);
        expect(errorCodeOf(result)).toBe('INTERNAL_ERROR');
        expect(colliding.gateway.calls).toHaveLength(0);
        expect(colliding.counters.randomCalls).toBe(5);
        expect(colliding.store.writes).toEqual([{ kind: 'quota.reserve', route }]);

        // Four collisions and a free fifth candidate: the request goes on with the fifth delimiter.
        // Call n draws bytes filled with n, so the code holds the first four candidates and the fifth is free.
        const recovering = setup(route, [outcomeFor('ok', goodOutput(route))], {
          corpses: [makeCorpse({ originalCode: codeWith([1, 2, 3, 4]) })],
          randomBytes: (call, length) => new Uint8Array(length).fill(call),
        });
        const recovered = await send(route, recovering);
        expect(recovered.status).toBe(200);
        expect(recovering.counters.randomCalls).toBe(5);
        expect(recovering.gateway.calls[0]!.prompt).toContain(`LAZARUS-UNTRUSTED-${hex(5)}`);
      }),
      { numRuns: 20 },
    );
  });

  it('R9.8 R15.10 leaves the corpse and the result tables unchanged for every failing step before the insert (Requirement 9)', async () => {
    // Feature: 05-llm-pipeline-api, Property 11: Generation failures write nothing
    await fc.assert(
      fc.asyncProperty(routes, fc.constantFrom('provider-error', 'timeout', 'auth', 'invalid-output', 'deadline', 'disconnect'), async (route, failure) => {
        const h = setup(route, [outcomeFor(failure), outcomeFor(failure)]);
        const before = JSON.stringify([h.store.corpseOf(OWNED_ID), h.store.seanceOf(OWNED_ID), h.store.reincarnationOf(OWNED_ID)]);
        await send(route, h);
        expect(JSON.stringify([h.store.corpseOf(OWNED_ID), h.store.seanceOf(OWNED_ID), h.store.reincarnationOf(OWNED_ID)])).toBe(before);
      }),
      { numRuns: 60 },
    );
  });
});
