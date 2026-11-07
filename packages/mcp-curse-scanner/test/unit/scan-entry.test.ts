import { describe, expect, it } from 'vitest';
import { extractFunctionSignatures, scanCurses } from '../../src/lib.ts';
import type { SourceLanguage } from '../../src/lib.ts';

const LANGUAGES: SourceLanguage[] = ['es3', 'es5-jquery', 'legacy-node'];

describe('scan entry points', () => {
  it('R3.3 returns a success value with the fixed property order', () => {
    const result = scanCurses('var a;', 'es5-jquery');
    expect(Object.keys(result)).toEqual(['ok', 'sourceLanguage', 'lineCount', 'curses']);
    if (result.ok) {
      expect(Object.keys(result.curses[0]!)).toEqual([
        'curseType', 'severity', 'lineNumber', 'column', 'description', 'exorcismStrategy',
      ]);
    }
  });

  it('R3.2 extractFunctionSignatures returns functions in the fixed property order', () => {
    const result = extractFunctionSignatures('var a;', 'es5-jquery');
    expect(Object.keys(result)).toEqual(['ok', 'sourceLanguage', 'lineCount', 'functions']);
  });

  it('R11.5 a Scan_Error has the property order ok, code, message, line, column', () => {
    const result = scanCurses('var 5;', 'es5-jquery');
    expect(Object.keys(result)).toEqual(['ok', 'code', 'message', 'line', 'column']);
    expect(Object.keys(scanCurses(1 as never, 'es3'))).toEqual(['ok', 'code', 'message']);
  });

  it('R3.9 empty and whitespace-only sources give a line count and no findings', () => {
    for (const language of LANGUAGES) {
      expect(scanCurses('', language)).toMatchObject({ ok: true, lineCount: 1, curses: [] });
      expect(scanCurses('  \n\t\n  ', language)).toMatchObject({ ok: true, lineCount: 3, curses: [] });
    }
  });

  it('R3.1 returns the language that was passed', () => {
    for (const language of LANGUAGES) expect(scanCurses('', language)).toMatchObject({ sourceLanguage: language });
  });

  it('R13.15 extractFunctionSignatures returns the same Scan_Error as scanCurses for invalid inputs', () => {
    const inputs: [unknown, unknown][] = [
      [1, 'es3'], ['var a;', 'nope'], ['var 5;', 'es3'], ['let a;', 'es5-jquery'], ['x'.repeat(1_048_577), 'es3'],
    ];
    for (const [source, language] of inputs) {
      expect(extractFunctionSignatures(source as string, language as SourceLanguage)).toEqual(
        scanCurses(source as string, language as SourceLanguage),
      );
    }
  });

  it('R12.7 a Scan_Error never contains curses or functions', () => {
    for (const result of [scanCurses('var 5;', 'es3'), extractFunctionSignatures('var 5;', 'es3')]) {
      expect(result).not.toHaveProperty('curses');
      expect(result).not.toHaveProperty('functions');
    }
  });

  it('R12.8 repeated Scan_Error values are byte-identical', () => {
    for (const [source, language] of [['var 5;', 'es3'], ['x'.repeat(1_048_577), 'es3'], [1, 'es3']] as const) {
      const first = JSON.stringify(scanCurses(source as string, language));
      expect(JSON.stringify(scanCurses(source as string, language))).toBe(first);
    }
  });

  it('R11.1 repeated success values are byte-identical', () => {
    const source = 'var a = 1;\nfunction f(x) { y = x == 2; }';
    const first = JSON.stringify(scanCurses(source, 'es5-jquery'));
    expect(JSON.stringify(scanCurses(source, 'es5-jquery'))).toBe(first);
  });

  it('R12.5 does not throw for non-string sources of any type', () => {
    for (const value of [undefined, null, 0, NaN, {}, [], Symbol('s'), 10n]) {
      expect(() => scanCurses(value as never, 'es3')).not.toThrow();
    }
  });
});
