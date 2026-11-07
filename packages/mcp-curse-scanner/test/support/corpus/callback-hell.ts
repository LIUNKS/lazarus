import { at, kase, type CorpusCase } from '../corpus.ts';

export const CALLBACK_HELL_CASES: CorpusCase[] = [
  kase('R7.1', 'three levels on one line', 'a(function () { b(function () { c(function () { d(); }); }); });', [
    at('CALLBACK_HELL', 1, 35),
  ]),
  kase(
    'R7.2',
    'four levels give two findings',
    'a(function () { b(function () { c(function () { d(function () {}); }); }); });',
    [at('CALLBACK_HELL', 1, 35), at('CALLBACK_HELL', 1, 51)],
  ),
  kase('R7.5', 'new expression arguments count as callbacks', 'new A(function () { b(function () { c(function () {}); }); });', [
    at('CALLBACK_HELL', 1, 39),
  ]),
  kase(
    'R7.6',
    'a non-callback function between callbacks neither counts nor resets',
    'a(function () { var g = function () { b(function () { c(function () {}); }); }; });',
    [at('VAR_HOISTING', 1, 17), at('CALLBACK_HELL', 1, 57)],
  ),
  kase('R7.3', 'two levels are not enough', 'a(function () { b(function () {}); });', []),
  kase('R7.4', 'function declarations are not callbacks', 'function f() { function g() { function h() {} } }', []),
  kase('R7.4', 'assigned function expressions are not callbacks', 'x.a = function () { x.b = function () { x.c = function () {}; }; };', []),
  kase('R7.4', 'immediately invoked functions are not callbacks', '(function () { (function () { (function () {})(); })(); })();', []),
  kase('R7.4', 'bound function expressions are not callbacks', 'a(function () { b(function () { (function () {}).bind(this); }); });', []),
];
