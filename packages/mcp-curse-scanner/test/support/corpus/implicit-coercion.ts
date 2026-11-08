import { at, kase, type CorpusCase } from '../corpus.ts';

export const IMPLICIT_COERCION_CASES: CorpusCase[] = [
  kase('R6.2', 'loose equality', 'a == b', [at('IMPLICIT_COERCION', 1, 1)]),
  kase('R6.2', 'loose inequality', 'a != b', [at('IMPLICIT_COERCION', 1, 1)]),
  kase('R6.2', 'inside a condition', 'if (x == null) {}', [at('IMPLICIT_COERCION', 1, 5)]),
  kase('R6.1', 'inside a function body', 'function f(a) {\n  return a == 1;\n}', [at('IMPLICIT_COERCION', 2, 10)]),
  kase('R6.1', 'inside call arguments', 'f(a != b);', [at('IMPLICIT_COERCION', 1, 3)]),
  kase('R6.3', 'strict equality', 'a === b; a !== b;', []),
  kase('R6.3', 'relational and assignment operators', 'a <= b; a >= b; x.y = 1;', []),
  kase('R6.3', 'operator text in a string', "x.y = '==';", []),
  kase('R6.3', 'operator text in a regular expression', 'x.y = /a==b/;', []),
  kase('R6.3', 'operator text in a comment', '// a == b\n/* a != b */', []),
  kase('R6.4', 'operator on the next line is reported at the expression start', 'a\n== b', [at('IMPLICIT_COERCION', 1, 1)]),
  kase('R6.5', 'nested loose operators give two findings', 'a == b != c', [
    at('IMPLICIT_COERCION', 1, 1),
    at('IMPLICIT_COERCION', 1, 1),
  ]),
  kase('R6.1', 'leading parenthesis counts', '(a) == b', [at('IMPLICIT_COERCION', 1, 1)]),
];
