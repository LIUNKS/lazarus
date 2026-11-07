import { describe, expect, it } from 'vitest';
import { extractFunctionSignatures } from '../../src/lib.ts';
import type { FunctionSignature } from '../../src/lib.ts';

function signatures(source: string): FunctionSignature[] {
  const result = extractFunctionSignatures(source, 'es5-jquery');
  if (!result.ok) throw new Error(`unexpected ${result.code}`);
  return result.functions;
}

describe('function signatures', () => {
  it('R13.1 lists declarations, expressions, nested functions, and callbacks', () => {
    const functions = signatures('function a() { function b() {} }\nvar c = function () {};\nd(function () {});');
    expect(functions).toHaveLength(4);
  });

  it('R13.2 sets kind to declaration or expression', () => {
    const [declaration, expression] = signatures('function a() {}\nvar b = function () {};');
    expect(declaration!.kind).toBe('declaration');
    expect(expression!.kind).toBe('expression');
  });

  it('R13.3 names a declaration and a named function expression', () => {
    const names = signatures('function a() {}\nvar x = function named() {};').map((fn) => fn.name);
    expect(names).toEqual(['a', 'named']);
  });

  it('R13.3 infers the name from `var name = function` and `name = function`', () => {
    const names = signatures('var a = function () {};\nb = function () {};').map((fn) => fn.name);
    expect(names).toEqual(['a', 'b']);
  });

  it('R13.3 gives null for a member assignment and for a callback', () => {
    const names = signatures('obj.name = function () {};\nf(function () {});').map((fn) => fn.name);
    expect(names).toEqual([null, null]);
  });

  it('R13.4 lists parameters in declaration order, and an empty list without parameters', () => {
    const [withParams, without] = signatures('function a(x, y, z) {}\nfunction b() {}');
    expect(withParams!.params).toEqual(['x', 'y', 'z']);
    expect(without!.params).toEqual([]);
  });

  it('R13.5 reports the position of the function keyword and the line of the closing brace', () => {
    const [fn] = signatures('var a = 1;\n  function f() {\n    return 1;\n  }');
    expect(fn).toMatchObject({ startLine: 2, startColumn: 3, endLine: 4 });
  });

  it('R13.5 endLine is at least startLine for a one-line function', () => {
    const [fn] = signatures('function f() {}');
    expect(fn).toMatchObject({ startLine: 1, startColumn: 1, endLine: 1 });
  });

  it('R13.6 counts the enclosing functions in nestingDepth', () => {
    const depths = signatures('function a() { function b() { function c() {} } }\nfunction d() {}').map((fn) => fn.nestingDepth);
    expect(depths).toEqual([0, 1, 2, 0]);
  });

  it('R13.17 sorts by start position', () => {
    const names = signatures('function b() {}\nfunction a() { function c() {} }').map((fn) => fn.name);
    expect(names).toEqual(['b', 'a', 'c']);
  });

  it('R13.18 a source without functions gives an empty list', () => {
    expect(signatures('var a = 1;')).toEqual([]);
    expect(extractFunctionSignatures('', 'es3')).toMatchObject({ ok: true, functions: [] });
  });

  it('R11.5 serializes the properties of a signature in the fixed order', () => {
    const [fn] = signatures('function f(a) {}');
    expect(Object.keys(fn!)).toEqual([
      'name', 'kind', 'params', 'startLine', 'startColumn', 'endLine', 'nestingDepth', 'pureCandidate', 'impurityMarkers',
    ]);
  });
});
