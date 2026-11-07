import { describe, it } from 'vitest';
import { runCase } from '../support/corpus.ts';
import { VAR_HOISTING_CASES } from '../support/corpus/var-hoisting.ts';

describe('VAR_HOISTING detector', () => {
  for (const testCase of VAR_HOISTING_CASES) {
    it(`${testCase.requirement} ${testCase.id}`, () => {
      runCase(testCase);
    });
  }
});
