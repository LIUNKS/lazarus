// A small parser for the restricted text of `requirements_md` and `design_md` (Spec_Markdown). Pure module: it produces
// typed blocks and never HTML, links, or images, so model-authored text cannot become markup. Every string it returns is
// meant to be rendered as a React text child.

export type InlineSegment = { kind: 'text' | 'code' | 'keyword'; text: string };

export type SpecBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'criterion'; number: number | null; segments: InlineSegment[] }
  | { kind: 'item'; ordered: boolean; number: number | null; segments: InlineSegment[] }
  | { kind: 'paragraph'; segments: InlineSegment[] }
  | { kind: 'code'; lines: string[] };

// `SHALL NOT` is listed before `SHALL`, so the longer keyword wins.
const KEYWORD_PATTERN = /\b(SHALL NOT|SHALL|THE|WHEN|WHILE|IF|WHERE|THEN)\b/g;
const EARS_START = /^(THE|WHEN|WHILE|IF|WHERE) /;
const SHALL_WORD = /\bSHALL\b/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const NUMBERED = /^\s*(\d+)\.\s+(.*)$/;
const BULLETED = /^\s*[-*]\s+(.*)$/;
const FENCE = '```';

function splitKeywords(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(KEYWORD_PATTERN)) {
    const index = match.index;
    if (index > last) segments.push({ kind: 'text', text: text.slice(last, index) });
    segments.push({ kind: 'keyword', text: match[0] });
    last = index + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}

/**
 * Splits one line on balanced single backticks. The text between a pair is a `code` segment, and an unmatched backtick
 * stays in a `text` segment. With `keywords: true`, the uppercase EARS keywords inside text segments become `keyword`
 * segments. The segments always add up to the input line, so `serializeInline(parseInline(line)) === line`.
 */
export function parseInline(line: string, options: { keywords?: boolean } = {}): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let pending = '';
  const flush = (): void => {
    if (pending === '') return;
    if (options.keywords === true) segments.push(...splitKeywords(pending));
    else segments.push({ kind: 'text', text: pending });
    pending = '';
  };
  let position = 0;
  while (position < line.length) {
    const open = line.indexOf('`', position);
    const close = open === -1 ? -1 : line.indexOf('`', open + 1);
    if (open === -1 || close === -1) {
      pending += line.slice(position);
      break;
    }
    pending += line.slice(position, open);
    flush();
    segments.push({ kind: 'code', text: line.slice(open + 1, close) });
    position = close + 1;
  }
  flush();
  return segments;
}

/** The inverse of `parseInline`: it puts the backticks back around `code` segments. */
export function serializeInline(segments: readonly InlineSegment[]): string {
  return segments.map((segment) => (segment.kind === 'code' ? `\`${segment.text}\`` : segment.text)).join('');
}

function isEarsCriterion(text: string): boolean {
  return EARS_START.test(text) && SHALL_WORD.test(text);
}

function listBlock(text: string, ordered: boolean, number: number | null): SpecBlock {
  if (isEarsCriterion(text)) return { kind: 'criterion', number, segments: parseInline(text, { keywords: true }) };
  return { kind: 'item', ordered, number, segments: parseInline(text) };
}

/**
 * Parses the text line by line into headings, criteria, list items, paragraphs, and fenced code blocks. It never throws.
 * Every character of a line is kept except the heading marker, the fence lines, and the backticks of code spans.
 */
export function parseSpecMarkdown(source: string): SpecBlock[] {
  const blocks: SpecBlock[] = [];
  let paragraph: string[] = [];
  let fence: string[] | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', segments: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };

  for (const line of source.replaceAll('\r\n', '\n').split('\n')) {
    if (fence !== null) {
      if (line.startsWith(FENCE)) {
        blocks.push({ kind: 'code', lines: fence });
        fence = null;
      } else {
        fence.push(line);
      }
      continue;
    }
    if (line.startsWith(FENCE)) {
      flushParagraph();
      fence = [];
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      flushParagraph();
      blocks.push({ kind: 'heading', level: heading[1]!.length as 1 | 2 | 3, text: heading[2]! });
      continue;
    }
    const numbered = NUMBERED.exec(line);
    // A number too large to be exact stays in a paragraph, so that its digits are not changed.
    if (numbered !== null && Number.isSafeInteger(Number(numbered[1]))) {
      flushParagraph();
      blocks.push(listBlock(numbered[2]!, true, Number(numbered[1])));
      continue;
    }
    const bulleted = BULLETED.exec(line);
    if (bulleted !== null) {
      flushParagraph();
      blocks.push(listBlock(bulleted[1]!, false, null));
      continue;
    }
    if (line.trim() === '') {
      flushParagraph();
      continue;
    }
    paragraph.push(line.trim());
  }
  // An unclosed fence runs to the end of the text.
  if (fence !== null) blocks.push({ kind: 'code', lines: fence });
  flushParagraph();
  return blocks;
}
