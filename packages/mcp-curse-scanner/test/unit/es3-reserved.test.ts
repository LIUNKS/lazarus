import * as acorn from 'acorn';
import { describe, expect, it } from 'vitest';
import { scanCurses } from '../../src/lib.ts';
import { ES3_RESERVED_WORDS } from '../../src/scanner/es3-reserved.ts';

const WORDS = [
  'abstract', 'boolean', 'byte', 'char', 'class', 'const', 'debugger', 'double', 'enum', 'export',
  'extends', 'final', 'float', 'goto', 'implements', 'import', 'int', 'interface', 'long', 'native',
  'package', 'private', 'protected', 'public', 'short', 'static', 'super', 'synchronized', 'throws',
  'transient', 'volatile',
];

const REJECTED_FORMS = [
  'var $W = 1;',
  'function $W() {}',
  'function f($W) {}',
  'x = $W;',
  'try {} catch ($W) {}',
  '$W: for (;;) {}',
  'var f = function $W() {};',
  'var a, $W;',
];

const ACCEPTED_FORMS = ['a.$W = 1;', 'var o = {$W: 1};', 'var v = o.$W;', 'o.$W();'];

function positionOf(template: string, word: string): { line: number; column: number } {
  const source = template.replace('$W', word);
  const column = source.indexOf(word) + 1;
  // acorn reads "debugger" as a statement keyword, so the label form fails at the colon after it.
  if (word === 'debugger' && template.startsWith('$W:')) return { line: 1, column: column + word.length };
  return { line: 1, column };
}

describe('ES3 reserved words', () => {
  it('R3.13 ES3_RESERVED_WORDS holds exactly the 31 words of the Glossary', () => {
    expect([...ES3_RESERVED_WORDS].sort()).toEqual([...WORDS].sort());
    expect(WORDS).toHaveLength(31);
  });

  describe.each(WORDS)('word %s', (word) => {
    it.each(REJECTED_FORMS)('R3.13 is rejected as an identifier: %s', (template) => {
      const result = scanCurses(template.replace('$W', word), 'es3');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('SYNTAX_ERROR');
        expect({ line: result.line, column: result.column }).toEqual(positionOf(template, word));
      }
    });

    it.each(ACCEPTED_FORMS)('R3.13 is accepted as a property name: %s', (template) => {
      expect(scanCurses(template.replace('$W', word), 'es3').ok).toBe(true);
    });
  });

  it('R3.13 the statement `debugger;` stays valid in es3', () => {
    expect(scanCurses('debugger;', 'es3').ok).toBe(true);
  });

  it('R3.13 rejects `var class = 1;`', () => {
    expect(scanCurses('var class = 1;', 'es3')).toMatchObject({ ok: false, code: 'SYNTAX_ERROR', line: 1, column: 5 });
  });
  it('R3.13 rejects `var int;`', () => {
    expect(scanCurses('var int;', 'es3')).toMatchObject({ ok: false, code: 'SYNTAX_ERROR', line: 1, column: 5 });
  });
  it('R3.13 rejects `function enum() {}`', () => {
    expect(scanCurses('function enum() {}', 'es3')).toMatchObject({ ok: false, code: 'SYNTAX_ERROR', line: 1, column: 10 });
  });
  it('R3.13 rejects `function f(class) {}`', () => {
    expect(scanCurses('function f(class) {}', 'es3')).toMatchObject({ ok: false, code: 'SYNTAX_ERROR', line: 1, column: 12 });
  });
  it('R3.13 accepts `a.class = 1;`', () => {
    expect(scanCurses('a.class = 1;', 'es3').ok).toBe(true);
  });
  it('R3.13 accepts `var o = {class: 1};`', () => {
    expect(scanCurses('var o = {class: 1};', 'es3').ok).toBe(true);
  });
  it('R3.13 accepts `var v = o.int;`', () => {
    expect(scanCurses('var v = o.int;', 'es3').ok).toBe(true);
  });

  it('R3.13 `const x = 1;` is rejected in es3 at 1:1', () => {
    expect(scanCurses('const x = 1;', 'es3')).toMatchObject({ ok: false, code: 'SYNTAX_ERROR', line: 1, column: 1 });
  });
  it('R3.13 `var const = 1;` is rejected at 1:5', () => {
    expect(scanCurses('var const = 1;', 'es3')).toMatchObject({ ok: false, code: 'SYNTAX_ERROR', line: 1, column: 5 });
  });
  it('R3.13 the escaped forms c\\u006Cass and c\\u006Fnst are rejected', () => {
    expect(scanCurses('var c\\u006Cass = 1;', 'es3')).toMatchObject({ ok: false, code: 'SYNTAX_ERROR', line: 1, column: 5 });
    expect(scanCurses('var c\\u006Fnst = 1;', 'es3')).toMatchObject({ ok: false, code: 'SYNTAX_ERROR', line: 1, column: 5 });
  });
  it('R3.13 an escaped reserved word is accepted as a property name', () => {
    expect(scanCurses('a.c\\u006Cass = 1;', 'es3').ok).toBe(true);
  });
  it('R3.13 the reserved word is reported before a later syntax error', () => {
    expect(scanCurses('var const = 1; var @x;', 'es3')).toMatchObject({ ok: false, line: 1, column: 5 });
  });
  it('R3.13 a reserved word on line 3 gives the expected line and column', () => {
    expect(scanCurses('\n\n  var x, int = 2;', 'es3')).toMatchObject({ ok: false, line: 3, column: 10 });
  });

  it('R3.12 with es5-jquery `var int = 1;` is accepted and `var class = 1;` is rejected', () => {
    expect(scanCurses('var int = 1;', 'es5-jquery').ok).toBe(true);
    expect(scanCurses('var class = 1;', 'es5-jquery')).toMatchObject({ ok: false, code: 'SYNTAX_ERROR' });
  });

  it('R3.13 acorn exposes checkUnreserved as a prototype method', () => {
    const hook = (acorn.Parser.prototype as unknown as { checkUnreserved?: unknown }).checkUnreserved;
    expect(
      typeof hook,
      `acorn ${acorn.version} no longer has Parser.prototype.checkUnreserved. Es3Parser in ` +
        'src/scanner/es3-reserved.ts relies on it. Replace the plugin with the post-parse identifier ' +
        'check described in task 4.5 of the spec.',
    ).toBe('function');
  });
});
