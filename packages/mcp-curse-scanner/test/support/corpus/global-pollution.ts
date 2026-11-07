import { at, kase, type CorpusCase } from '../corpus.ts';

export const GLOBAL_POLLUTION_CASES: CorpusCase[] = [
  kase('R4.4', 'undeclared assignment', 'counter = 0;', [at('GLOBAL_POLLUTION', 1, 1)]),
  kase('R4.4', 'undeclared compound assignment', 'total += 1;', [at('GLOBAL_POLLUTION', 1, 1)]),
  kase('R4.4', 'window property', 'window.cache = {};', [at('GLOBAL_POLLUTION', 1, 1)]),
  kase('R4.4', 'global property', 'global.helper = fn;', [at('GLOBAL_POLLUTION', 1, 1)]),
  kase('R4.4', 'computed window property', "window['x'] = 1;", [at('GLOBAL_POLLUTION', 1, 1)]),
  kase('R4.4', 'chained assignment gives two findings', 'a = b = 0;', [
    at('GLOBAL_POLLUTION', 1, 1),
    at('GLOBAL_POLLUTION', 1, 5),
  ]),
  kase('R4.3', 'local window does not suppress the finding', 'function f(window) { window.x = 1; }', [
    at('GLOBAL_POLLUTION', 1, 22),
  ]),
  kase('R4.1', 'undeclared write inside a function', 'function f() { q = 2; }', [at('GLOBAL_POLLUTION', 1, 16)]),
  kase('R4.5', 'var declaration is not an assignment', 'var counter = 0;', [at('VAR_HOISTING', 1, 1)]),
  kase('R4.5', 'assignment to a parameter', 'function f(p) { p = 1; }', []),
  kase('R4.5', 'var declared later in the same function', 'function f() { x = 1; var x; }', [
    at('VAR_HOISTING', 1, 23),
  ]),
  kase('R4.5', 'var declared in an enclosing function', 'function f() { var x; function g() { x = 1; } }', [
    at('VAR_HOISTING', 1, 16),
  ]),
  kase('R4.5', 'member of another object', "obj.name = 'x';", []),
  kase('R4.5', 'this member', 'this.value = 1;', []),
  kase('R4.5', 'module exports', 'module.exports = fn;', []),
  kase('R4.5', 'object of the target is not window', 'window.a.b = 1;', []),
  kase('R4.5', 'catch parameter inside its block', 'try {} catch (e) { e = 1; }', []),
  kase('R4.2', 'arguments inside a function', 'function f() { arguments = 1; }', []),
  kase('R4.2', 'function declaration name', 'function f() {} f = 1;', []),
  kase('R4.2', 'named function expression name inside itself', 'var g = function h() { h = 1; };', [
    at('VAR_HOISTING', 1, 1),
  ]),
  kase('R4.6', 'update expression', 'i++;', []),
  kase('R4.6', 'for-in loop variable', 'for (k in o) {}', []),
];
