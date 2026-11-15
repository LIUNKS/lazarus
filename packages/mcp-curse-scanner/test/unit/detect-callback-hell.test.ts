import { describe, it } from 'vitest';
import { runCase } from '../support/corpus.ts';
import { CALLBACK_HELL_CASES } from '../support/corpus/callback-hell.ts';

describe('CALLBACK_HELL detector', () => {
  for (const testCase of CALLBACK_HELL_CASES) {
    it(`${testCase.requirement} ${testCase.id}`, () => {
      runCase(testCase);
    });
  }
});
