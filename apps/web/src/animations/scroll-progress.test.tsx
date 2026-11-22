import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Reveal } from './reveal-section';
import { ScrollProgress } from './scroll-progress';

const SRC = path.resolve(import.meta.dirname, '..');

describe('R6 Reveal trigger', () => {
  const content = <p data-reveal>Hex Scanner</p>;

  it('R1.5 R6.1 renders the same visible markup for both triggers', () => {
    const load = renderToStaticMarkup(<Reveal className="space-y-10">{content}</Reveal>);
    expect(renderToStaticMarkup(<Reveal className="space-y-10" trigger="scroll">{content}</Reveal>)).toBe(load);
    expect(load).toBe('<div class="space-y-10"><p data-reveal="true">Hex Scanner</p></div>');
  });

  it('R6.3 R6.4 uses the scroll trigger for the stage sections and the load trigger for the header and the cards', () => {
    expect(readFileSync(path.join(SRC, 'components', 'stages', 'stage-sections.tsx'), 'utf8')).toContain('<Reveal className="space-y-10" trigger="scroll">');
    for (const file of ['site-header.tsx', 'corpse-grid.tsx']) {
      const source = readFileSync(path.join(SRC, 'components', file), 'utf8');
      expect(source, file).toContain('<Reveal');
      expect(source, file).not.toContain('trigger=');
    }
  });
});

describe('R7 Progress_Bar markup', () => {
  it('R7.1 R7.4 is fixed decoration at the top that takes no pointer events and is invisible until animated', () => {
    expect(renderToStaticMarkup(<ScrollProgress />)).toBe(
      '<div aria-hidden="true" class="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-foreground/70 opacity-0"></div>',
    );
  });
});
