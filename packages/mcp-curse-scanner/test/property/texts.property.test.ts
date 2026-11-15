import fc from 'fast-check';
import { describe, it } from 'vitest';
import { scanCurses } from '../../src/lib.ts';
import { CURSE_TABLE } from '../../src/scanner/constants.ts';
import { injectedProgram } from '../support/clean-corpus.ts';

const FORBIDDEN = ['100%', 'mathematical proof', 'mathematically proven', 'guaranteed'];
const NOISE = ['100% guaranteed', 'mathematical proof', 'GLOBAL_POLLUTION', 'EVAL_INJECTION', 'eval(x)', '__proto__', 'FATAL'];

const noise = fc.oneof(fc.constantFrom(...NOISE), fc.string({ maxLength: 30 }));

// A string literal and a block comment that carry arbitrary text. JSON.stringify escapes quotes
// and control characters, and the comment text cannot close the comment.
const LINE_SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, 'g');

const noiseLines = noise.map((text) => {
  const literal = JSON.stringify(text).replace(LINE_SEPARATORS, (char) => `\\u${char.charCodeAt(0).toString(16)}`);
  return [`var zzText = ${literal};`, `/* ${text.replaceAll('*/', '* /')} */`];
});

const printableAscii = /^[ -~]+$/;

describe('texts and severities', () => {
  it('R10.1 every finding carries the table entry of its curse type, whatever the source text says', () => {
    // Feature: 02-scanner-and-verifier, Property 10: Texts and severities depend only on the curse type
    fc.assert(
      fc.property(injectedProgram, noiseLines, (program, extra) => {
        const result = scanCurses([...extra, program.source].join('\n'), 'es5-jquery');
        if (!result.ok) return false;
        return result.curses.every((finding) => {
          const entry = CURSE_TABLE[finding.curseType];
          const texts = [finding.description, finding.exorcismStrategy];
          return (
            finding.severity === entry.severity &&
            finding.description === entry.description &&
            finding.exorcismStrategy === entry.exorcismStrategy &&
            texts.every(
              (text) =>
                printableAscii.test(text) &&
                text.trim().length >= 10 &&
                text.trim().length <= 500 &&
                !FORBIDDEN.some((phrase) => text.toLowerCase().includes(phrase)),
            )
          );
        });
      }),
      { numRuns: 150 },
    );
  });

  it('R10.4 the six descriptions and the six strategies are pairwise different', () => {
    const all = Object.values(CURSE_TABLE).flatMap((entry) => [entry.description, entry.exorcismStrategy]);
    if (new Set(all).size !== all.length) throw new Error('texts are not pairwise different');
  });
});
