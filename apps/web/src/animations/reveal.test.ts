import { describe, expect, it } from 'vitest';
import { REVEAL_FROM } from './reveal';

describe('R4 Reveal_Timeline', () => {
  it('animates only opacity and transform', () => {
    expect(Object.keys(REVEAL_FROM).sort()).toEqual(['opacity', 'y']);
  });
});