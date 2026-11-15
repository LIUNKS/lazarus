import { describe, it } from 'vitest';
import { runCase } from '../support/corpus.ts';
import { PROTOTYPE_POLLUTION_CASES } from '../support/corpus/prototype-pollution.ts';

describe('PROTOTYPE_POLLUTION detector', () => {
  for (const testCase of PROTOTYPE_POLLUTION_CASES) {
    it(`${testCase.requirement} ${testCase.id}`, () => {
      runCase(testCase);
    });
  }
});
