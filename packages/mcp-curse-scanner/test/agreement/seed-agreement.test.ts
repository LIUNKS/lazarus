import { describe, expect, it } from 'vitest';
import { extractFunctionSignatures, scanCurses } from '../../src/lib.ts';
import { loadSeedSamples } from '../support/seed-loader.ts';
import { describeEntryMismatch, describeMismatch } from '../support/seed-mismatch.ts';

// Loaded once at collection time. A problem never skips: it registers a failing test.
const { samples, problems } = loadSeedSamples();

describe('seed agreement', () => {
  if (problems.length > 0) {
    it('R17.7 R17.8 seed prerequisites are met', () => {
      throw new Error(problems.join('\n'));
    });
  }

  for (const sample of samples) {
    describe(`Sample_Source ${sample.folder} (${sample.sourceLanguage})`, () => {
      it('R17.2 the scanner returns a success value', () => {
        const result = scanCurses(sample.legacy, sample.sourceLanguage);
        expect(result.ok, result.ok ? '' : `${result.code}: ${result.message}`).toBe(true);
      });

      it('R17.3 R17.4 every Seeded_Curse has a finding of the same type on its Seeded_Line with the seeded severity', () => {
        const result = scanCurses(sample.legacy, sample.sourceLanguage);
        if (!result.ok) throw new Error(`Sample_Source "${sample.folder}": ${result.code}: ${result.message}`);
        // Requirement 17.5: the seeded list is a lower bound, so the number of findings is never asserted.
        for (const curse of sample.curses) {
          const onLine = result.curses.filter(
            (finding) => finding.curseType === curse.type && finding.lineNumber === curse.seededLine,
          );
          if (onLine.length === 0) throw new Error(describeMismatch(sample.folder, curse, result.curses));
          for (const finding of onLine) {
            expect(
              finding.severity,
              `Sample_Source "${sample.folder}": ${curse.type} at line ${curse.seededLine} has severity ${finding.severity}, seeded ${curse.severity}`,
            ).toBe(curse.severity);
          }
        }
      });

      it('R17.6 the Entry_Function appears exactly once, as a top-level function declaration', () => {
        const result = extractFunctionSignatures(sample.legacy, sample.sourceLanguage);
        if (!result.ok) throw new Error(`Sample_Source "${sample.folder}": ${result.code}: ${result.message}`);
        const entries = result.functions.filter((signature) => signature.name === sample.entryFunction);
        if (entries.length !== 1) throw new Error(describeEntryMismatch(sample.folder, sample.entryFunction, result.functions));
        expect(entries[0]).toMatchObject({ nestingDepth: 0, kind: 'declaration' });
      });
    });
  }
});
