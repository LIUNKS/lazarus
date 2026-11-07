import { describe, expect, it } from 'vitest';
import { scanCurses } from '../../src/lib.ts';
import type { SourceLanguage } from '../../src/lib.ts';

const LANGUAGES: SourceLanguage[] = ['es3', 'es5-jquery', 'legacy-node'];

describe('parsing', () => {
  const es2015 = [
    ['let declaration', 'let x = 1;'],
    ['const declaration', 'const x = 1;'],
    ['arrow function', 'var f = () => 1;'],
    ['template literal', 'var s = `a`;'],
    ['class', 'class A {}'],
    ['import', 'import a from "b";'],
  ] as const;

  for (const [label, source] of es2015) {
    it(`R3.11 ${label} gives SYNTAX_ERROR in every language`, () => {
      for (const language of LANGUAGES) {
        const result = scanCurses(source, language);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe('SYNTAX_ERROR');
          expect(result).not.toHaveProperty('curses');
        }
      }
    });
  }

  it('R3.11 `let;` is a plain identifier in ES5 and parses', () => {
    for (const language of LANGUAGES) expect(scanCurses('let;', language).ok).toBe(true);
  });

  it('R3.6 a hashbang on line 1 is accepted only for legacy-node', () => {
    const source = '#!/usr/bin/env node\nvar a;';
    expect(scanCurses(source, 'legacy-node').ok).toBe(true);
    for (const language of ['es3', 'es5-jquery'] as const) {
      const result = scanCurses(source, language);
      expect(result).toMatchObject({ ok: false, code: 'SYNTAX_ERROR', line: 1, column: 1 });
    }
  });

  it('R3.12 a hashbang on line 2 is rejected for every language', () => {
    for (const language of LANGUAGES) {
      const result = scanCurses('var a;\n#!/usr/bin/env node', language);
      expect(result).toMatchObject({ ok: false, code: 'SYNTAX_ERROR', line: 2 });
    }
  });

  it('R3.6 a top-level return is accepted only for legacy-node', () => {
    expect(scanCurses('return 1;', 'legacy-node').ok).toBe(true);
    for (const language of ['es3', 'es5-jquery'] as const) {
      expect(scanCurses('return 1;', language)).toMatchObject({ ok: false, code: 'SYNTAX_ERROR' });
    }
  });

  it('R3.12 reports the line and column of a syntax error on line 3', () => {
    const result = scanCurses('var a;\nvar b;\nvar 5;', 'es5-jquery');
    expect(result).toMatchObject({ ok: false, code: 'SYNTAX_ERROR', line: 3, column: 5 });
  });

  it('R3.12 the message has no position suffix and at most 500 characters', () => {
    const result = scanCurses('var 5;', 'es5-jquery');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toMatch(/\(\d+:\d+\)$/);
      expect(result.message.length).toBeLessThanOrEqual(500);
    }
  });

  it('R12.3 20,000 nested parentheses map to LIMIT_EXCEEDED without throwing', () => {
    const source = '('.repeat(20_000) + 'a' + ')'.repeat(20_000) + ';';
    for (const language of LANGUAGES) {
      const result = scanCurses(source, language);
      expect(result).toMatchObject({ ok: false, code: 'LIMIT_EXCEEDED' });
      expect(result).not.toHaveProperty('line');
    }
  });

  it('R3.9 an empty source and a comment-only source succeed with no findings', () => {
    expect(scanCurses('', 'es3')).toMatchObject({ ok: true, lineCount: 1, curses: [] });
    expect(scanCurses('// only\n/* a\nb */\n', 'es5-jquery')).toMatchObject({ ok: true, lineCount: 4, curses: [] });
  });
});
