import { describe, it } from 'vitest';
import { runCase } from '../support/corpus.ts';
import { GLOBAL_POLLUTION_CASES } from '../support/corpus/global-pollution.ts';

describe('GLOBAL_POLLUTION detector', () => {
  for (const testCase of GLOBAL_POLLUTION_CASES) {
    it(`${testCase.requirement} ${testCase.id}`, () => {
      runCase(testCase);
    });
  }
});
