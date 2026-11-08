import { describe, it } from 'vitest';
import { runCase } from '../support/corpus.ts';
import { IMPLICIT_COERCION_CASES } from '../support/corpus/implicit-coercion.ts';

describe('IMPLICIT_COERCION detector', () => {
  for (const testCase of IMPLICIT_COERCION_CASES) {
    it(`${testCase.requirement} ${testCase.id}`, () => {
      runCase(testCase);
    });
  }
});
