import { describe, expect, it } from 'vitest';
import { scanCurses } from '../../src/lib.ts';
import type { SourceLanguage } from '../../src/lib.ts';
import { runScan } from '../../src/scanner/scan.ts';
import { measureDepthCapability } from '../support/depth-capability.ts';
import { flatList, levelsForDepth, nestedParentheses, SHAPE_NAMES, SHAPES } from '../support/shapes.ts';

const LANGUAGES: SourceLanguage[] = ['es3', 'es5-jquery'];
const capability = measureDepthCapability();
const limitExceeded = { ok: false, code: 'LIMIT_EXCEEDED' };

describe('scan resource limits', () => {
  for (const language of LANGUAGES) {
    describe(language, () => {
      it('R12.2 accepts a source of exactly 1,048,576 bytes and rejects one more', () => {
        const base = '//' + 'a'.repeat(1_048_576 - 2);
        expect(scanCurses(base, language).ok).toBe(true);
        expect(scanCurses(base + 'a', language)).toMatchObject({ ok: false, code: 'INPUT_TOO_LARGE' });
      });

      it('R12.3 accepts 200,000 nodes and rejects 200,001 through the parser', () => {
        expect(scanCurses(flatList(199_999), language).ok).toBe(true);
        expect(scanCurses(flatList(200_000), language)).toMatchObject(limitExceeded);
      });

      for (const shape of capability.usable512) {
        const definition = SHAPES[shape];
        it(`R12.3 accepts depth 512 and rejects depth 513 (mode: parser, construct: ${shape})`, () => {
          expect(scanCurses(definition.build(levelsForDepth(definition, 512)), language).ok).toBe(true);
          expect(scanCurses(definition.build(levelsForDepth(definition, 513)), language)).toMatchObject(limitExceeded);
        });
      }

      it('R12.3 member and call chains of 100,000 links give LIMIT_EXCEEDED', () => {
        for (const shape of ['member-chain', 'call-chain'] as const) {
          expect(scanCurses(SHAPES[shape].build(100_000), language)).toMatchObject(limitExceeded);
        }
      });

      it('R12.3 nested arrays, parentheses, and blocks with 100,000 levels give LIMIT_EXCEEDED without throwing', () => {
        const sources = [SHAPES['nested-arrays'].build(100_000), nestedParentheses(100_000), SHAPES['nested-blocks'].build(100_000)];
        for (const source of sources) expect(scanCurses(source, language)).toMatchObject(limitExceeded);
      });

      it('R12.3 20,000 nested parentheses give LIMIT_EXCEEDED', () => {
        expect(scanCurses(nestedParentheses(20_000), language)).toMatchObject(limitExceeded);
      });

      it('R3.12 reports the position of a syntax error on line 3', () => {
        expect(scanCurses('var a;\nvar b;\n  var 5;', language)).toMatchObject({ ok: false, line: 3, column: 7 });
      });

      it('R12.4 TIMEOUT with an injected clock returns no lists', () => {
        let time = 0;
        const result = runScan('var a;', language, 'curses', {
          now: () => {
            const value = time;
            time += 10_000;
            return value;
          },
          timeBudgetMs: 5_000,
        });
        expect(result).toMatchObject({ ok: false, code: 'TIMEOUT' });
        expect(result).not.toHaveProperty('curses');
        expect(result).not.toHaveProperty('functions');
      });
    });
  }

  describe('Stack_Limit_Source shapes (weak assertion)', () => {
    const shapes = [...SHAPE_NAMES.filter((name) => !['member-chain', 'call-chain'].includes(name)), 'parentheses'] as const;
    for (const shape of shapes) {
      it(`R12.3 ${shape} at 400 to 1,000 levels never throws and gives a success value or LIMIT_EXCEEDED`, () => {
        for (const level of [400, 500, 512, 513, 600, 800, 1_000]) {
          const source = shape === 'parentheses' ? nestedParentheses(level) : SHAPES[shape].build(level);
          for (const language of LANGUAGES) {
            const result = scanCurses(source, language);
            expect(result.ok || result.code === 'LIMIT_EXCEEDED').toBe(true);
          }
        }
      });
    }
  });
});
