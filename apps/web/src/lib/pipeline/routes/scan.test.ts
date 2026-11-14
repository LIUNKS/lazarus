import { scanCurses } from '@lazarus/mcp-curse-scanner';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkResponse, errorCodeOf } from '@/lib/testing/assert-response';
import { bodyFor, buildHarness, makeCorpse, OWNED_ID, requestFor, sampleCorpse, SAMPLE_ID } from '@/lib/testing/harness';
import { countLines } from '../count-lines';
import type { CurseRowOut } from '../types';
import { handleScan } from './scan';

const POOL = [
  'var a = 1;',
  'function f(x) { return x == null; }',
  "eval('1 + 1');",
  'Object.prototype.extra = 1;',
  'globalVar = 3;',
  'function g() { return 2; }',
  'if (a == 1) { var b = 2; }',
  '// a comment',
  '',
];
const TERMINATORS = ['\n', '\r\n', '\r', '\u2028'];

const sources = fc.array(fc.tuple(fc.constantFrom(...POOL), fc.constantFrom(...TERMINATORS)), { minLength: 1, maxLength: 14 }).map((lines) => lines.map(([line, end]) => `${line}${end}`).join(''));
const language = fc.constantFrom('es3' as const, 'es5-jquery' as const, 'legacy-node' as const);

const OLD: CurseRowOut[] = [{ curseType: 'EVAL_INJECTION', severity: 'FATAL', lineNumber: 99, description: 'old row', exorcismStrategy: 'old strategy' }];

const scan = async (h: ReturnType<typeof buildHarness>, corpseId = OWNED_ID) => checkResponse(await handleScan(requestFor('scan', bodyFor(corpseId)), h.deps));
const sortedByRule = (rows: CurseRowOut[]) => [...rows].sort((a, b) => a.lineNumber - b.lineNumber || (a.curseType < b.curseType ? -1 : a.curseType > b.curseType ? 1 : 0));

describe('R5 scan route (Requirement 5)', () => {
  it('R5.1 R5.2 R5.3 stores and returns the findings ordered by line and curse type, with five fields and the scanner line count (Requirement 5)', async () => {
    // Feature: 05-llm-pipeline-api, Property 19: Scan route
    await fc.assert(
      fc.asyncProperty(sources, language, async (code, sourceLanguage) => {
        const expected = scanCurses(code, sourceLanguage);
        fc.pre(expected.ok);
        if (!expected.ok) return;
        const h = buildHarness({ corpses: [makeCorpse({ originalCode: code, sourceLanguage })], curses: { [OWNED_ID]: OLD } });
        const result = await scan(h);

        expect(result.status).toBe(200);
        const findings: CurseRowOut[] = expected.curses.map((f) => ({ curseType: f.curseType, severity: f.severity, lineNumber: f.lineNumber, description: f.description, exorcismStrategy: f.exorcismStrategy }));
        expect(result.body).toEqual({ ok: true, source: 'generated', lineCount: expected.lineCount, curses: sortedByRule(findings) });
        for (const curse of result.body['curses'] as object[]) expect(Object.keys(curse).sort()).toEqual(['curseType', 'description', 'exorcismStrategy', 'lineNumber', 'severity']);
        // The whole set replaced the old rows in one call.
        expect(h.store.writesOfKind('curses.replace')).toEqual([{ kind: 'curses.replace', corpseId: OWNED_ID, count: findings.length }]);
        expect(sortedByRule(h.store.cursesOf(OWNED_ID))).toEqual(sortedByRule(findings));
        // The scan route never touches the LLM parts.
        expect(h.counters.configReads).toBe(0);
        expect(h.gateway.calls).toHaveLength(0);
        expect(h.store.quotaCalls).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('R5.8 leaves the same stored rows after a second scan of the same code (Requirement 5)', async () => {
    // Feature: 05-llm-pipeline-api, Property 19: Scan route
    await fc.assert(
      fc.asyncProperty(sources, async (code) => {
        const h = buildHarness({ corpses: [makeCorpse({ originalCode: code })] });
        const first = await scan(h);
        const afterFirst = h.store.cursesOf(OWNED_ID);
        const second = await scan(h);
        expect(second.body).toEqual(first.body);
        expect(h.store.cursesOf(OWNED_ID)).toEqual(afterFirst);
      }),
      { numRuns: 100 },
    );
  });

  it('R5.3 removes the stored rows and answers an empty list when the scan finds nothing (Requirement 5)', async () => {
    const h = buildHarness({ corpses: [makeCorpse({ originalCode: 'function clean(a) {\n  return a;\n}\n' })], curses: { [OWNED_ID]: OLD } });
    const result = await scan(h);
    expect(result.body).toEqual({ ok: true, source: 'generated', lineCount: 4, curses: [] });
    expect(h.store.cursesOf(OWNED_ID)).toEqual([]);
    expect(h.store.writesOfKind('curses.replace')).toHaveLength(1);
  });

  it('R5.9 keeps the previous rows and answers INTERNAL_ERROR when the replacement fails (Requirement 5)', async () => {
    // Feature: 05-llm-pipeline-api, Property 19: Scan route
    await fc.assert(
      fc.asyncProperty(sources, async (code) => {
        const h = buildHarness({ corpses: [makeCorpse({ originalCode: code })], curses: { [OWNED_ID]: OLD } });
        h.store.failOn('replaceCurses');
        const result = await scan(h);
        expect(result.status).toBe(500);
        expect(errorCodeOf(result)).toBe('INTERNAL_ERROR');
        expect(h.store.cursesOf(OWNED_ID)).toEqual(OLD);
        expect(h.store.writes).toEqual([]);
      }),
      { numRuns: 50 },
    );
  });

  it('R5.5 answers a syntax error with line and column in the message, and leaves the rows unchanged (Requirement 5)', async () => {
    // Feature: 05-llm-pipeline-api, Property 19: Scan route
    await fc.assert(
      fc.asyncProperty(sources, fc.constantFrom('function (', 'var = ;', 'if (', 'x = = 1;'), async (code, breaker) => {
        const broken = `${code}\n${breaker}\n`;
        const expected = scanCurses(broken, 'es5-jquery');
        expect(expected.ok).toBe(false);
        if (expected.ok) return;
        const h = buildHarness({ corpses: [makeCorpse({ originalCode: broken })], curses: { [OWNED_ID]: OLD } });
        const result = await scan(h);
        expect(result.status).toBe(422);
        expect(errorCodeOf(result)).toBe(expected.code === 'SYNTAX_ERROR' ? 'SOURCE_SYNTAX_ERROR' : 'SOURCE_NOT_SCANNABLE');
        const message = (result.body['error'] as { message: string }).message;
        if (expected.line !== undefined && expected.column !== undefined) {
          expect(message).toContain(`line ${expected.line}, column ${expected.column}`);
        }
        expect(h.store.cursesOf(OWNED_ID)).toEqual(OLD);
        expect(h.store.writes).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it('R5.5 answers SOURCE_NOT_SCANNABLE for a source over the scanner limits, with no position (Requirement 5)', async () => {
    const deep = `var d = ${'['.repeat(700)}${']'.repeat(700)};\n`;
    const h = buildHarness({ corpses: [makeCorpse({ originalCode: deep })] });
    const result = await scan(h);
    expect(errorCodeOf(result)).toBe('SOURCE_NOT_SCANNABLE');
    expect(h.store.writes).toEqual([]);
  });

  it('R5.4 returns the stored curses of a sample in the same order, with the counted line number, and scans nothing (Requirement 5)', async () => {
    // Feature: 05-llm-pipeline-api, Property 19: Scan route
    const rows: CurseRowOut[] = [
      { curseType: 'VAR_HOISTING', severity: 'HEX', lineNumber: 5, description: 'later', exorcismStrategy: 's' },
      { curseType: 'GLOBAL_POLLUTION', severity: 'BLOOD_CURSE', lineNumber: 2, description: 'second', exorcismStrategy: 's' },
      { curseType: 'EVAL_INJECTION', severity: 'FATAL', lineNumber: 2, description: 'first', exorcismStrategy: 's' },
    ];
    await fc.assert(
      fc.asyncProperty(sources, fc.constantFrom(null, 'member'), async (code, caller) => {
        const h = buildHarness({ memberId: caller === null ? null : undefined, corpses: [sampleCorpse({ originalCode: code })], curses: { [SAMPLE_ID]: rows } });
        const result = await scan(h, SAMPLE_ID);
        expect(result.body).toEqual({ ok: true, source: 'precomputed', lineCount: countLines(code), curses: sortedByRule(rows) });
        const scanned = scanCurses(code, 'es5-jquery');
        if (scanned.ok) expect(countLines(code)).toBe(scanned.lineCount);
        expect(h.store.writes).toEqual([]);
        expect(h.store.calls).toEqual(['loadCorpse', 'getCurses']);
      }),
      { numRuns: 100 },
    );
    // A sample whose code has a syntax error still answers: the stored rows are used and nothing is scanned.
    const broken = buildHarness({ corpses: [sampleCorpse({ originalCode: 'function (' })] });
    expect((await scan(broken, SAMPLE_ID)).body).toMatchObject({ ok: true, source: 'precomputed', curses: [] });
  });

  it('R5.4 answers INTERNAL_ERROR when the stored curses of a sample cannot be read (Requirement 5)', async () => {
    const h = buildHarness({ corpses: [sampleCorpse()] });
    h.store.failOn('getCurses');
    expect(errorCodeOf(await scan(h, SAMPLE_ID))).toBe('INTERNAL_ERROR');
  });
});
