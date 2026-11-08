import { at, kase, type CorpusCase } from '../corpus.ts';

export const EVAL_INJECTION_CASES: CorpusCase[] = [
  kase('R8.1', 'eval call', 'eval(x);', [at('EVAL_INJECTION', 1, 1)]),
  kase('R8.2', 'Function call', "Function('return 1');", [at('EVAL_INJECTION', 1, 1)]),
  kase('R8.3', 'new Function', "new Function('a', 'return a');", [at('EVAL_INJECTION', 1, 1)]),
  kase('R8.4', 'parenthesized callee', '(eval)(x);', [at('EVAL_INJECTION', 1, 1)]),
  kase('R8.4', 'nested eval calls give two findings', 'eval(eval(x));', [
    at('EVAL_INJECTION', 1, 1),
    at('EVAL_INJECTION', 1, 6),
  ]),
  kase('R8.4', 'only the inner Function call matches', "Function('return this')();", [at('EVAL_INJECTION', 1, 1)]),
  kase('R8.5', 'a local eval declaration does not suppress the finding', 'function f(eval) { eval(1); }', [
    at('EVAL_INJECTION', 1, 20),
  ]),
  kase('R8.6', 'member callee', 'obj.eval(x);', []),
  kase('R8.6', 'Function without a call', 'x.y = Function;', []),
  kase('R8.6', 'indirect eval through a sequence', '(0, eval)(x);', []),
  kase('R8.6', 'eval in a string and a comment', "x.y = 'eval(x)'; // eval(x)", []),
];
