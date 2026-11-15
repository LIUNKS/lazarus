import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseInline, parseSpecMarkdown, serializeInline, type InlineSegment } from './spec-markdown';

const BLOCK_KINDS = ['heading', 'criterion', 'item', 'paragraph', 'code'];

/** Text biased toward the characters the parser treats specially, mixed with arbitrary strings. */
const specialText = fc
  .array(fc.constantFrom('`', '``', '```', 'a', ' ', '\n', '\r\n', '#', '## ', '1. ', '- ', '* ', 'THE', 'SHALL', 'SHALL NOT', 'IF ', '<b>', '99999999999999999999. '), {
    maxLength: 24,
  })
  .map((parts) => parts.join(''));
const anyText = fc.oneof(specialText, fc.string({ maxLength: 60 }));

const kinds = (blocks: ReturnType<typeof parseSpecMarkdown>) => blocks.map((block) => block.kind);
const texts = (segments: InlineSegment[]) => segments.map((segment) => `${segment.kind}:${segment.text}`);

describe('R4.7 Spec_Markdown parser: totality and round trip', () => {
  it('never throws and returns only the five block kinds', () => {
    // Feature: 06-resurrection-ui, Property 3: Spec_Markdown round trip and totality
    fc.assert(
      fc.property(anyText, (source) => parseSpecMarkdown(source).every((block) => BLOCK_KINDS.includes(block.kind))),
      { numRuns: 200 },
    );
  });

  it('serializes the inline segments of any line back to the line, with and without keywords', () => {
    // Feature: 06-resurrection-ui, Property 3: Spec_Markdown round trip and totality
    fc.assert(
      fc.property(anyText, (line) => {
        return (
          serializeInline(parseInline(line)) === line && serializeInline(parseInline(line, { keywords: true })) === line
        );
      }),
      { numRuns: 200 },
    );
  });

  it('makes one code segment for each balanced pair of backticks', () => {
    // Feature: 06-resurrection-ui, Property 3: Spec_Markdown round trip and totality
    fc.assert(
      fc.property(anyText, (line) => {
        const backticks = [...line].filter((character) => character === '`').length;
        const codeSegments = parseInline(line).filter((segment) => segment.kind === 'code');
        return codeSegments.length === Math.floor(backticks / 2) && codeSegments.every((segment) => !segment.text.includes('`'));
      }),
      { numRuns: 200 },
    );
  });
});

describe('R4.1 EARS criteria detection', () => {
  const words = fc.array(fc.constantFrom('the', 'function', 'returns', 'a', 'value', 'when', 'input', 'is', 'empty'), {
    minLength: 1,
    maxLength: 6,
  });
  const lead = fc.constantFrom('THE', 'WHEN', 'WHILE', 'IF', 'WHERE');
  const prefix = fc.oneof(
    fc.integer({ min: 1, max: 99 }).map((n) => ({ text: `${n}. `, number: n as number | null })),
    fc.constant({ text: '- ', number: null as number | null }),
  );

  it('reads "<KEYWORD> <words> SHALL <words>" as a criterion with its number, and the same line without SHALL as an item', () => {
    // Feature: 06-resurrection-ui, Property 4: EARS detection
    fc.assert(
      fc.property(prefix, lead, words, words, (start, keyword, before, after) => {
        const withShall = `${start.text}${keyword} ${before.join(' ')} SHALL ${after.join(' ')}`;
        const withoutShall = `${start.text}${keyword} ${before.join(' ')} ${after.join(' ')}`;
        const [criterion] = parseSpecMarkdown(withShall);
        const [plain] = parseSpecMarkdown(withoutShall);
        const keywordSegments = criterion?.kind === 'criterion' ? criterion.segments.filter((segment) => segment.kind === 'keyword').map((s) => s.text) : [];
        return (
          criterion?.kind === 'criterion' &&
          criterion.number === start.number &&
          keywordSegments[0] === keyword &&
          keywordSegments.includes('SHALL') &&
          plain?.kind === 'item'
        );
      }),
      { numRuns: 200 },
    );
  });

  it('does not read a lowercase "shall" or a line that does not start with an EARS keyword as a criterion', () => {
    expect(kinds(parseSpecMarkdown('1. THE function shall return a number.'))).toEqual(['item']);
    expect(kinds(parseSpecMarkdown('1. The function SHALL return a number.'))).toEqual(['item']);
    expect(kinds(parseSpecMarkdown('1. THEORY says it SHALL work.'))).toEqual(['item']);
  });

  it('shows SHALL NOT as one bold keyword and leaves the code spans plain', () => {
    const [block] = parseSpecMarkdown('1. THE system SHALL NOT call `SHALL` twice.');
    expect(block).toEqual({
      kind: 'criterion',
      number: 1,
      segments: [
        { kind: 'keyword', text: 'THE' },
        { kind: 'text', text: ' system ' },
        { kind: 'keyword', text: 'SHALL NOT' },
        { kind: 'text', text: ' call ' },
        { kind: 'code', text: 'SHALL' },
        { kind: 'text', text: ' twice.' },
      ],
    });
  });

  it('marks THEN and the opening keywords in the middle of a criterion as keywords', () => {
    const [block] = parseSpecMarkdown('2. IF the input is empty, THEN THE function SHALL return zero.');
    expect(block?.kind === 'criterion' && block.segments.filter((s) => s.kind === 'keyword').map((s) => s.text)).toEqual([
      'IF',
      'THEN',
      'THE',
      'SHALL',
    ]);
  });
});

describe('R4.7 Spec_Markdown blocks', () => {
  it('reads headings of level 1 to 3 and keeps a deeper marker as paragraph text', () => {
    expect(parseSpecMarkdown('# One\n## Two\n### Three\n#### Four')).toEqual([
      { kind: 'heading', level: 1, text: 'One' },
      { kind: 'heading', level: 2, text: 'Two' },
      { kind: 'heading', level: 3, text: 'Three' },
      { kind: 'paragraph', segments: [{ kind: 'text', text: '#### Four' }] },
    ]);
  });

  it('reads a fenced block as lines of code and drops the fence lines', () => {
    expect(parseSpecMarkdown('Before\n```ts\nconst a = 1;\n  indented();\n```\nAfter')).toEqual([
      { kind: 'paragraph', segments: [{ kind: 'text', text: 'Before' }] },
      { kind: 'code', lines: ['const a = 1;', '  indented();'] },
      { kind: 'paragraph', segments: [{ kind: 'text', text: 'After' }] },
    ]);
  });

  it('lets an unclosed fence run to the end of the text', () => {
    expect(parseSpecMarkdown('```\nline one\n# not a heading\n1. not a list')).toEqual([
      { kind: 'code', lines: ['line one', '# not a heading', '1. not a list'] },
    ]);
  });

  it('keeps an empty fenced block', () => {
    expect(parseSpecMarkdown('```\n```')).toEqual([{ kind: 'code', lines: [] }]);
  });

  it('reads numbered and bulleted lines, with the number only for numbered ones', () => {
    expect(parseSpecMarkdown('3. First point\n- Second point\n* Third point')).toEqual([
      { kind: 'item', ordered: true, number: 3, segments: [{ kind: 'text', text: 'First point' }] },
      { kind: 'item', ordered: false, number: null, segments: [{ kind: 'text', text: 'Second point' }] },
      { kind: 'item', ordered: false, number: null, segments: [{ kind: 'text', text: 'Third point' }] },
    ]);
  });

  it('joins consecutive plain lines into one paragraph and splits paragraphs on blank lines', () => {
    expect(parseSpecMarkdown('line one\n  line two  \n\nnext paragraph')).toEqual([
      { kind: 'paragraph', segments: [{ kind: 'text', text: 'line one line two' }] },
      { kind: 'paragraph', segments: [{ kind: 'text', text: 'next paragraph' }] },
    ]);
  });

  it('reads Windows line endings like Unix ones', () => {
    expect(parseSpecMarkdown('# Title\r\n1. Point\r\n')).toEqual(parseSpecMarkdown('# Title\n1. Point\n'));
  });

  it('keeps a numbered line whose number is not an exact integer as a paragraph with its digits', () => {
    expect(parseSpecMarkdown('99999999999999999999. Too large')).toEqual([
      { kind: 'paragraph', segments: [{ kind: 'text', text: '99999999999999999999. Too large' }] },
    ]);
  });

  it('returns no blocks for an empty text', () => {
    expect(parseSpecMarkdown('')).toEqual([]);
    expect(parseSpecMarkdown('\n\n  \n')).toEqual([]);
  });
});

describe('R4.7 R14.1 inline code and untrusted text', () => {
  it('reads balanced backticks as code and keeps an unmatched backtick in the text', () => {
    expect(texts(parseInline('use `Math.round` here'))).toEqual(['text:use ', 'code:Math.round', 'text: here']);
    expect(texts(parseInline('`a` and `b'))).toEqual(['code:a', 'text: and `b']);
    expect(texts(parseInline('lonely ` tick'))).toEqual(['text:lonely ` tick']);
    expect(texts(parseInline('``'))).toEqual(['code:']);
  });

  it('shows markup in the text as plain text segments, never as a new kind of block', () => {
    const blocks = parseSpecMarkdown('<script>alert(1)</script>\n1. <img src=x onerror=alert(1)> THE x SHALL y');
    expect(kinds(blocks)).toEqual(['paragraph', 'item']);
    expect(blocks[0]).toEqual({ kind: 'paragraph', segments: [{ kind: 'text', text: '<script>alert(1)</script>' }] });
    const serialized = blocks.flatMap((block) => ('segments' in block ? [serializeInline(block.segments)] : []));
    expect(serialized).toEqual(['<script>alert(1)</script>', '<img src=x onerror=alert(1)> THE x SHALL y']);
  });

  it('does not turn a link or an image into anything but text', () => {
    const [block] = parseSpecMarkdown('[click](https://example.test) ![x](y.png)');
    expect(block).toEqual({ kind: 'paragraph', segments: [{ kind: 'text', text: '[click](https://example.test) ![x](y.png)' }] });
  });
});
