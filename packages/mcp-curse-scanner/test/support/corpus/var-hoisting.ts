import { at, kase, type CorpusCase } from '../corpus.ts';

export const VAR_HOISTING_CASES: CorpusCase[] = [
  kase('R5.1', 'single var', 'var a = 1;', [at('VAR_HOISTING', 1, 1)]),
  kase('R5.1', 'one finding per declaration statement', 'var a = 1, b = 2;', [at('VAR_HOISTING', 1, 1)]),
  kase('R5.1', 'two statements', 'var a;\nvar b;', [at('VAR_HOISTING', 1, 1), at('VAR_HOISTING', 2, 1)]),
  kase('R5.2', 'for initializer', 'for (var i = 0; i < 3; i = i + 1) {}', [at('VAR_HOISTING', 1, 6)]),
  kase('R5.2', 'for-in initializer', 'for (var k in o) {}', [at('VAR_HOISTING', 1, 6)]),
  kase('R5.3', 'inside a function body', 'function f() {\n  var x;\n}', [at('VAR_HOISTING', 2, 3)]),
  kase('R5.4', 'var inside a block', 'if (a) { var x; }', [at('VAR_HOISTING', 1, 10)]),
  kase('R5.5', 'identifier named variable', 'variable = 1;', [at('GLOBAL_POLLUTION', 1, 1)]),
  kase('R5.5', 'identifier named vars', 'function f(vars) { return vars; }', []),
  kase('R5.5', 'var in a string', "x.y = 'var a';", []),
  kase('R5.5', 'var in a regular expression', 'x.y = /var a/;', []),
  kase('R5.5', 'var in a comment', '// var a\n/* var b */', []),
  kase('R5.6', 'parameter is not a declaration statement', 'function f(a) { return a; }', []),
  kase('R5.6', 'empty source', '', []),
];
