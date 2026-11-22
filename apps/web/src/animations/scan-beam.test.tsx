import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CodeView } from '@/components/code-view';
import { AnchorGlide } from './anchor-glide';
import { ScanBeam } from './scan-beam';

const CODE = 'var a = 1;\neval(a);\nvar b = 2;\n';

describe('R2 Scan_Beam markup', () => {
  const plain = renderToStaticMarkup(<CodeView code={CODE} markedLines={new Set([2])} />);
  const wrapped = renderToStaticMarkup(
    <ScanBeam markedLines={[2]} lineCount={3}>
      <CodeView code={CODE} markedLines={new Set([2])} />
    </ScanBeam>,
  );

  it('R1.5 R2.1 renders the source view and its curse markers exactly as without the beam', () => {
    expect(wrapped).toContain(plain);
    expect(wrapped).toContain('Curse on this line');
  });

  it('R2.7 renders the beam as hidden decoration that does not take pointer events', () => {
    const decoration = wrapped.slice(wrapped.indexOf(plain) + plain.length);
    expect(decoration).toMatch(/^<div aria-hidden="true" class="pointer-events-none [^"]*"><div data-scan-beam="true" class="[^"]*opacity-0[^"]*"><\/div><\/div><\/div>$/);
  });

  it('R2.6 renders the same way for a source without curses', () => {
    const none = renderToStaticMarkup(
      <ScanBeam markedLines={[]} lineCount={3}>
        <CodeView code={CODE} />
      </ScanBeam>,
    );
    expect(none).toContain(renderToStaticMarkup(<CodeView code={CODE} />));
  });
});

describe('R3 AnchorGlide markup', () => {
  it('R1.5 R3.6 renders nothing, so links keep their native markup', () => {
    expect(renderToStaticMarkup(<AnchorGlide />)).toBe('');
  });
});
