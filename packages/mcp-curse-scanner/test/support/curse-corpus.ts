import { CALLBACK_HELL_CASES } from './corpus/callback-hell.ts';
import { EVAL_INJECTION_CASES } from './corpus/eval-injection.ts';
import { GLOBAL_POLLUTION_CASES } from './corpus/global-pollution.ts';
import { IMPLICIT_COERCION_CASES } from './corpus/implicit-coercion.ts';
import { PROTOTYPE_POLLUTION_CASES } from './corpus/prototype-pollution.ts';
import { VAR_HOISTING_CASES } from './corpus/var-hoisting.ts';
import type { CorpusCase } from './corpus.ts';
import type { CurseType } from '../../src/lib.ts';

export const CURSE_CORPUS: CorpusCase[] = [
  ...GLOBAL_POLLUTION_CASES,
  ...VAR_HOISTING_CASES,
  ...IMPLICIT_COERCION_CASES,
  ...CALLBACK_HELL_CASES,
  ...EVAL_INJECTION_CASES,
  ...PROTOTYPE_POLLUTION_CASES,
];

/** A self-contained, single-line statement and the findings it produces on its own line. */
export interface InjectableSnippet {
  source: string;
  expected: { curseType: CurseType; column: number }[];
}

const four = 'zzA(function () { zzB(function () { zzC(function () { zzD(function () {}); }); }); });';

export const INJECTABLE_SNIPPETS: InjectableSnippet[] = [
  { source: 'zzGlobal = 1;', expected: [{ curseType: 'GLOBAL_POLLUTION', column: 1 }] },
  { source: 'window.zzCache = {};', expected: [{ curseType: 'GLOBAL_POLLUTION', column: 1 }] },
  { source: 'var zzVar = 1;', expected: [{ curseType: 'VAR_HOISTING', column: 1 }] },
  { source: 'zzA == zzB;', expected: [{ curseType: 'IMPLICIT_COERCION', column: 1 }] },
  {
    source: four,
    expected: [
      { curseType: 'CALLBACK_HELL', column: four.indexOf('function () { zzD') + 1 },
      { curseType: 'CALLBACK_HELL', column: four.indexOf('function () {}') + 1 },
    ],
  },
  { source: 'eval(zzCode);', expected: [{ curseType: 'EVAL_INJECTION', column: 1 }] },
  { source: 'zzTarget[zzKey] = 1;', expected: [{ curseType: 'PROTOTYPE_POLLUTION', column: 1 }] },
];
