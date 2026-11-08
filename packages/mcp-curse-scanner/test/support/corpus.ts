import { expect } from 'vitest';
import { scanCurses } from '../../src/lib.ts';
import type { CurseType, SourceLanguage } from '../../src/lib.ts';

export interface ExpectedFinding {
  curseType: CurseType;
  lineNumber: number;
  column?: number;
}

export interface CorpusCase {
  id: string;
  /** Requirement and criterion, for example `R4.4`. It starts the test name. */
  requirement: string;
  language: SourceLanguage;
  source: string;
  /** The exact finding list, in the order of Requirement 11.2. */
  expected: ExpectedFinding[];
}

export function runCase(testCase: CorpusCase): void {
  const result = scanCurses(testCase.source, testCase.language);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const actual = result.curses.map((finding, index) => {
    const expectedColumn = testCase.expected[index]?.column;
    return {
      curseType: finding.curseType,
      lineNumber: finding.lineNumber,
      ...(expectedColumn === undefined ? {} : { column: finding.column }),
    };
  });
  expect(actual).toEqual(testCase.expected);
}

export function kase(
  requirement: string,
  id: string,
  source: string,
  expected: ExpectedFinding[],
  language: SourceLanguage = 'es5-jquery',
): CorpusCase {
  return { id, requirement, language, source, expected };
}

export function at(curseType: CurseType, lineNumber: number, column: number): ExpectedFinding {
  return { curseType, lineNumber, column };
}
