import { at, kase, type CorpusCase } from '../corpus.ts';

export const PROTOTYPE_POLLUTION_CASES: CorpusCase[] = [
  kase('R9.1', '__proto__ member', 'obj.__proto__ = p;', [at('PROTOTYPE_POLLUTION', 1, 1)]),
  kase('R9.1', '__proto__ computed string', "obj['__proto__'] = p;", [at('PROTOTYPE_POLLUTION', 1, 1)]),
  kase('R9.1', '__proto__ compound assignment', 'obj.__proto__ += 1;', [at('PROTOTYPE_POLLUTION', 1, 1)]),
  kase('R9.2', 'computed identifier key', 'target[key] = v;', [at('PROTOTYPE_POLLUTION', 1, 1)]),
  kase('R9.2', 'computed expression key', "target[a + 'b'] = v;", [at('PROTOTYPE_POLLUTION', 1, 1)]),
  kase('R9.2', 'chained assignments give one finding each', 'a[k1] = b[k2] = v;', [
    at('PROTOTYPE_POLLUTION', 1, 1),
    at('PROTOTYPE_POLLUTION', 1, 9),
  ]),
  kase('R9.3', 'one finding per assignment expression', 'x[k] += 1;', [at('PROTOTYPE_POLLUTION', 1, 1)]),
  kase('R9.4', 'static member', 'obj.name = v;', []),
  kase('R9.4', 'computed string literal', "obj['name'] = v;", []),
  kase('R9.4', 'computed number literal', 'list[0] = v;', []),
  kase('R9.5', 'read access', 'x.y = target[key];', []),
  kase('R9.5', 'read access of the prototype', 'x.y = obj.__proto__;', []),
  kase('R9.5', 'update expression', 'target[key]++;', []),
];
