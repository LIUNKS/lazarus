import { scanCurses } from '@lazarus/mcp-curse-scanner';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { countLines } from './count-lines';
import { checkEligibility } from './eligibility';
import type { SourceLanguage } from './types';

const LANGUAGES: SourceLanguage[] = ['es3', 'es5-jquery', 'legacy-node'];
const language = fc.constantFrom(...LANGUAGES);
const bytes = (text: string) => new TextEncoder().encode(text).length;
const TERMINATORS = ['\n', '\r', '\r\n', '\u2028', '\u2029'];

interface FunctionSpec {
  name: string;
  params: string[];
}

const functionSpecs = fc
  .array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 5 })
  .map((counts) => counts.map<FunctionSpec>((count, index) => ({ name: `fn_${index}`, params: Array.from({ length: count }, (_, p) => `p${p}`) })));

const noiseStatement = fc.constantFrom(
  'var counter = 0;',
  'var table = { a: 1, b: [1, 2, 3] };',
  'var wrapped = function inner(x) { return x; };',
  '// a comment with accents: caf\u00e9 \u20ac',
  '/* block comment */',
);

// Nested declarations and function expressions must never become Entry_Candidates.
function render(specs: FunctionSpec[], noise: string[], terminator: string): string {
  const parts: string[] = [];
  specs.forEach((spec, index) => {
    parts.push(`function ${spec.name}(${spec.params.join(', ')}) { function nested${index}() { return ${index}; } return ${index}; }`);
    const extra = noise[index];
    if (extra !== undefined) parts.push(extra);
  });
  return parts.join(terminator) + terminator;
}

// Pads a valid source with a comment so that its UTF-8 size is exactly `target`, using 1-, 2-, 3-, and 4-byte characters.
function padToBytes(base: string, target: number, filler: string[]): string {
  let text = `${base}// `;
  for (const piece of filler) {
    if (bytes(text) + bytes(piece) > target) break;
    text += piece;
  }
  return text + 'a'.repeat(Math.max(0, target - bytes(text)));
}

describe('R6 source eligibility (Requirement 6)', () => {
  it('R6.5 returns exactly the top-level named declarations, in source order, with name, params, purity, and markers (Requirement 6)', () => {
    // Feature: 05-llm-pipeline-api, Property 7: Source eligibility
    fc.assert(
      fc.property(functionSpecs, fc.array(noiseStatement, { maxLength: 5 }), fc.constantFrom(...TERMINATORS), language, (specs, noise, terminator, lang) => {
        const result = checkEligibility(render(specs, noise, terminator), lang);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.candidates.map((c) => c.name)).toEqual(specs.map((s) => s.name));
        expect(result.candidates.map((c) => c.params)).toEqual(specs.map((s) => s.params));
        for (const candidate of result.candidates) {
          expect(typeof candidate.pureCandidate).toBe('boolean');
          expect(Array.isArray(candidate.impurityMarkers)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('R6.2 accepts a source of exactly 20,000 UTF-8 bytes and rejects one byte more, including multi-byte text (Requirement 6)', () => {
    // Feature: 05-llm-pipeline-api, Property 7: Source eligibility
    fc.assert(
      fc.property(
        fc.integer({ min: 19_990, max: 20_010 }),
        fc.array(fc.constantFrom('a', '\u00e9', '\u20ac', '\u{1F600}'), { maxLength: 400 }),
        language,
        (target, filler, lang) => {
          const source = padToBytes('function boundary(a) { return a; }\n', target, filler);
          expect(bytes(source)).toBe(target);
          const result = checkEligibility(source, lang);
          if (target <= 20_000) expect(result.ok, `size ${target}`).toBe(true);
          else expect(!result.ok && result.error.code, `size ${target}`).toBe('SOURCE_TOO_LARGE');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('R6.3 maps a syntax error to SOURCE_SYNTAX_ERROR and a limit error to SOURCE_NOT_SCANNABLE (Requirement 6)', () => {
    // Feature: 05-llm-pipeline-api, Property 7: Source eligibility
    fc.assert(
      fc.property(functionSpecs, fc.constantFrom('function (', 'var = ;', '}}', 'if (', 'x = = 1;'), language, (specs, breaker, lang) => {
        const result = checkEligibility(`${render(specs, [], '\n')}${breaker}\n`, lang);
        expect(!result.ok && result.error.code).toBe('SOURCE_SYNTAX_ERROR');
      }),
      { numRuns: 100 },
    );
    const deep = `var d = ${'['.repeat(700)}${']'.repeat(700)};\nfunction ok() { return 1; }\n`;
    const result = checkEligibility(deep, 'es5-jquery');
    expect(!result.ok && result.error.code).toBe('SOURCE_NOT_SCANNABLE');
  });

  it('R6.4 returns NO_ENTRY_FUNCTION when no top-level named declaration exists (Requirement 6)', () => {
    // Feature: 05-llm-pipeline-api, Property 7: Source eligibility
    const sources = [
      '',
      '// only a comment\n',
      'var f = function () { return 1; };\n',
      'var g = function named() { return 1; };\n',
      '(function () { function insideIife() { return 1; } insideIife(); })();\n',
      'var o = { m: function () { return 1; } };\n',
    ];
    fc.assert(
      fc.property(fc.constantFrom(...sources), language, (source, lang) => {
        const result = checkEligibility(source, lang);
        expect(!result.ok && result.error.code, JSON.stringify(source)).toBe('NO_ENTRY_FUNCTION');
      }),
      { numRuns: 100 },
    );
  });

  it('R6.1 reports only the first failing check: size before scan, scan before entry candidate (Requirement 6)', () => {
    // Feature: 05-llm-pipeline-api, Property 7: Source eligibility
    const tooLargeAndBroken = `function (${'a'.repeat(20_001)}`;
    expect(checkEligibility(tooLargeAndBroken, 'es3')).toMatchObject({ ok: false, error: { code: 'SOURCE_TOO_LARGE' } });
    expect(checkEligibility('var x = ;', 'es3')).toMatchObject({ ok: false, error: { code: 'SOURCE_SYNTAX_ERROR' } });
    expect(checkEligibility('var x = 1;', 'es3')).toMatchObject({ ok: false, error: { code: 'NO_ENTRY_FUNCTION' } });
  });

  it('R5.3 countLines equals the scanner lineCount for generated texts with any mix of line terminators (Requirement 5)', () => {
    // Feature: 05-llm-pipeline-api, Supporting check: countLines parity with the scanner
    const statement = fc.constantFrom('var a = 1;', '', '// note', 'function f() { return 1; }');
    fc.assert(
      fc.property(fc.array(fc.tuple(statement, fc.constantFrom(...TERMINATORS, '')), { maxLength: 25 }), language, (pieces, lang) => {
        const text = pieces.map(([line, end]) => `${line}${end}`).join('');
        const scan = scanCurses(text, lang);
        if (!scan.ok) return;
        expect(countLines(text)).toBe(scan.lineCount);
      }),
      { numRuns: 200 },
    );
    expect(countLines('')).toBe(1);
    expect(countLines('a\r\nb')).toBe(2);
    expect(countLines('a\n\r')).toBe(3);
  });
});
