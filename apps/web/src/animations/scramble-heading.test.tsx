import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ScrambleHeading } from './scramble-heading';

const SRC = path.resolve(import.meta.dirname, '..');

describe('R8 Morgue title and cards', () => {
  it('R1.5 R8.2 renders a plain h1 with the final text and no aria-label in the server markup', () => {
    expect(renderToStaticMarkup(<ScrambleHeading text="The Morgue" className="font-serif text-5xl font-bold" />)).toBe(
      '<h1 class="font-serif text-5xl font-bold">The Morgue</h1>',
    );
  });

  it('R8.2 stays the only h1 of the Morgue page', () => {
    const source = readFileSync(path.join(SRC, 'app', '(morgue)', 'page.tsx'), 'utf8');
    expect(source).toContain('<ScrambleHeading text="The Morgue"');
    expect(source).not.toContain('<h1');
  });

  it('R8.3 lifts a card on hover only behind motion-safe and highlights it with neutral tokens', () => {
    const source = readFileSync(path.join(SRC, 'components', 'corpse-card.tsx'), 'utf8');
    expect(source).toContain('motion-safe:hover:-translate-y-0.5');
    expect(source).not.toMatch(/(?<!motion-safe:)hover:-?translate/);
    expect(source).not.toMatch(/hover:[^\s"]*(?:curse|verified)/);
  });
});
