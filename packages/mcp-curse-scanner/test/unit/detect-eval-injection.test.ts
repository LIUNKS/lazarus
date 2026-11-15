import { describe, it } from 'vitest';
import { runCase } from '../support/corpus.ts';
import { EVAL_INJECTION_CASES } from '../support/corpus/eval-injection.ts';

describe('EVAL_INJECTION detector', () => {
  for (const testCase of EVAL_INJECTION_CASES) {
    it(`${testCase.requirement} ${testCase.id}`, () => {
      runCase(testCase);
    });
  }
});
