import fc from 'fast-check';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { countSourceLines } from '@/lib/stages/scanner-view';
import { CodeView } from './code-view';

const count = (html: string, text: string) => html.split(text).length - 1;

describe('R3.5 CodeView', () => {
  it('keeps the defaults of the shell: the label, line ids that the curse links point to, and no marker', () => {
    const html = renderToStaticMarkup(<CodeView code={'var a = 1;\nvar b = 2;\n'} />);
    expect(html).toContain('aria-label="Original source code"');
    expect(html).toContain('id="source-line-1"');
    expect(html).toContain('id="source-line-2"');
    expect(html).not.toContain('id="source-line-3"');
    expect(html).not.toContain('Curse on this line');
    expect(html).not.toContain('border-curse');
  });

  it('marks each line that has a curse with the crimson token and hidden text, and leaves the others alone', () => {
    const html = renderToStaticMarkup(<CodeView code={'a\nb\nc\n'} markedLines={new Set([2])} />);
    expect(count(html, 'Curse on this line')).toBe(1);
    expect(html).toMatch(/<li id="source-line-2" class="[^"]*border-curse[^"]*"><span aria-hidden="true"[^>]*>2<\/span><span class="sr-only">Curse on this line<\/span>/);
    expect(html).toMatch(/<li id="source-line-1" class="[^"]*border-transparent/);
  });

  it('R3.5 does not convey the marker by color alone', () => {
    expect(renderToStaticMarkup(<CodeView code="a" markedLines={new Set([1])} />)).toContain('class="sr-only">Curse on this line');
  });

  it('R5.6 takes its label and the prefix of its line ids from its props', () => {
    const html = renderToStaticMarkup(<CodeView code={'x\ny'} label="Resurrected TypeScript" idPrefix="modern" />);
    expect(html).toContain('aria-label="Resurrected TypeScript"');
    expect(html).toContain('id="modern-line-2"');
    expect(html).not.toContain('source-line');
  });

  it('does not count the newline at the end as another line, and shows an empty line as a space', () => {
    expect(count(renderToStaticMarkup(<CodeView code={'a\nb\n'} />), '<li ')).toBe(2);
    expect(renderToStaticMarkup(<CodeView code={'a\n\nb'} />)).toContain('<code class="pr-4 whitespace-pre"> </code>');
  });

  it('R14.1 shows markup in the code as characters', () => {
    const html = renderToStaticMarkup(<CodeView code={'<script>alert(1)</script>'} />);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('R3.5 shows as many lines as countSourceLines says, for any source', () => {
    // Feature: 06-resurrection-ui, Supporting check: the source view and the line count agree
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (code) => count(renderToStaticMarkup(<CodeView code={code} />), '<li ') === countSourceLines(code)),
      { numRuns: 100 },
    );
  });
});
