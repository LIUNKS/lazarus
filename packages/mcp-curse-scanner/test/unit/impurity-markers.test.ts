import { describe, expect, it } from 'vitest';
import { extractFunctionSignatures } from '../../src/lib.ts';
import type { FunctionSignature, ImpurityMarker } from '../../src/lib.ts';

function markersOf(source: string, index = 0): ImpurityMarker[] {
  const result = extractFunctionSignatures(source, 'es5-jquery');
  if (!result.ok) throw new Error(`unexpected ${result.code}`);
  return result.functions[index]!.impurityMarkers;
}

function all(source: string): FunctionSignature[] {
  const result = extractFunctionSignatures(source, 'es5-jquery');
  if (!result.ok) throw new Error(`unexpected ${result.code}`);
  return result.functions;
}

describe('impurity markers', () => {
  it('R13.7 GLOBAL_WRITE for an undeclared assignment', () => {
    expect(markersOf('function f() { counter = 1; }')).toEqual(['GLOBAL_WRITE']);
  });

  it('R13.7 GLOBAL_WRITE for a compound assignment and for ++', () => {
    expect(markersOf('function f() { total += 1; }')).toEqual(['GLOBAL_WRITE']);
    expect(markersOf('function f() { total++; }')).toEqual(['GLOBAL_WRITE']);
  });

  it('R13.7 GLOBAL_WRITE for a member of window or global', () => {
    expect(markersOf('function f() { window.x = 1; }')).toContain('GLOBAL_WRITE');
    expect(markersOf('function f() { global.x = 1; }')).toContain('GLOBAL_WRITE');
  });

  it('R13.8 OUTER_SCOPE_WRITE for a variable declared outside the function', () => {
    expect(markersOf('var n = 0;\nfunction f() { n = 1; }', 0)).toEqual(['OUTER_SCOPE_WRITE']);
    expect(markersOf('var n = 0;\nfunction f() { n++; }', 0)).toEqual(['OUTER_SCOPE_WRITE']);
  });

  it('R13.8 no OUTER_SCOPE_WRITE for a parameter or a local variable', () => {
    expect(markersOf('function f(p) { p = 1; }')).toEqual([]);
    expect(markersOf('function f() { var v; v = 1; }')).toEqual([]);
  });

  it('R13.9 NONDETERMINISTIC_API for Date and Math.random', () => {
    expect(markersOf('function f() { return new Date(); }')).toEqual(['NONDETERMINISTIC_API']);
    expect(markersOf('function f() { return Math.random(); }')).toEqual(['NONDETERMINISTIC_API']);
    expect(markersOf("function f() { return Math['random'](); }")).toEqual(['NONDETERMINISTIC_API']);
  });

  it('R13.9 a property named Date or random of another object adds no marker', () => {
    expect(markersOf('function f(o) { return o.Date + o.random + { random: 1 }.random; }')).toEqual([]);
    expect(markersOf('function f() { return Math.floor(1); }')).toEqual([]);
  });

  it('R13.10 TIMER_API for setTimeout, setInterval, and setImmediate', () => {
    for (const name of ['setTimeout', 'setInterval', 'setImmediate']) {
      expect(markersOf(`function f() { ${name}(g, 1); }`)).toEqual(['TIMER_API']);
    }
  });

  it('R13.11 ENVIRONMENT_API for each watched environment name', () => {
    const names = [
      'window', 'document', 'global', '$', 'jQuery', 'XMLHttpRequest', 'navigator', 'localStorage',
      'sessionStorage', 'require', 'process', 'console', 'module',
    ];
    for (const name of names) {
      expect(markersOf(`function f() { return ${name}; }`), name).toEqual(['ENVIRONMENT_API']);
    }
  });

  it('R13.11 a watched name passed directly as a call argument is a reference', () => {
    expect(markersOf('function f() { g(console); }')).toEqual(['ENVIRONMENT_API']);
    expect(markersOf('function f() { new g(Date); }')).toEqual(['NONDETERMINISTIC_API']);
    expect(markersOf('function f() { g(setTimeout); }')).toEqual(['TIMER_API']);
  });

  it('R13.12 DYNAMIC_CODE for an EVAL_INJECTION finding', () => {
    expect(markersOf('function f(x) { return eval(x); }')).toEqual(['DYNAMIC_CODE']);
    expect(markersOf("function f() { return new Function('return 1'); }")).toEqual(['DYNAMIC_CODE']);
  });

  it('R13.9 declared Date, setTimeout, and window add no marker', () => {
    expect(markersOf('var Date = 1;\nfunction f() { return Date; }', 0)).toEqual([]);
    expect(markersOf('function f(setTimeout) { setTimeout(1); }')).toEqual([]);
    expect(markersOf('function f(window) { return window; }')).toEqual([]);
  });

  it('R13.7 markers of a nested function propagate to every enclosing function', () => {
    const [outer, middle, inner] = all('function a() { function b() { function c() { counter = 1; } } }');
    expect(outer!.impurityMarkers).toEqual(['GLOBAL_WRITE']);
    expect(middle!.impurityMarkers).toEqual(['GLOBAL_WRITE']);
    expect(inner!.impurityMarkers).toEqual(['GLOBAL_WRITE']);
  });

  it('R13.8 an outer-scope write marks only the functions inside the declaring scope', () => {
    const [outer, inner] = all('function a() { var l; function b() { l = 1; } }');
    expect(outer!.impurityMarkers).toEqual([]);
    expect(inner!.impurityMarkers).toEqual(['OUTER_SCOPE_WRITE']);
  });

  it('R13.13 lists markers in the fixed order, each at most once', () => {
    const source =
      'var outer;\nfunction f(x) { eval(x); console.log(1); setTimeout(g); Date.now(); outer = 1; undeclared = 1; undeclared = 2; }';
    expect(markersOf(source, 0)).toEqual([
      'GLOBAL_WRITE', 'OUTER_SCOPE_WRITE', 'NONDETERMINISTIC_API', 'TIMER_API', 'ENVIRONMENT_API', 'DYNAMIC_CODE',
    ]);
  });

  it('R13.16 pureCandidate is true if and only if there is no marker', () => {
    const [pure, impure] = all('function a(x) { return x + 1; }\nfunction b() { counter = 1; }');
    expect(pure).toMatchObject({ pureCandidate: true, impurityMarkers: [] });
    expect(impure).toMatchObject({ pureCandidate: false });
  });
});
