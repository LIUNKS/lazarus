// Builders for the resource-limit test sources. `n` is the number of nesting levels (or links).
export interface Shape {
  /** Source for `n` levels. */
  build(n: number): string;
  /** Tree depth of `build(n)`, as `slope * n + offset`. Program is depth 1. */
  slope: number;
  offset: number;
}

export const flatList = (n: number): string => ';'.repeat(n);

export const SHAPES = {
  'member-chain': { build: (n) => 'a' + '.a'.repeat(n) + ';', slope: 1, offset: 3 },
  'call-chain': { build: (n) => 'a' + '()'.repeat(n) + ';', slope: 1, offset: 3 },
  'nested-arrays': { build: (n) => '['.repeat(n) + ']'.repeat(n) + ';', slope: 1, offset: 2 },
  'nested-blocks': { build: (n) => '{'.repeat(n) + '}'.repeat(n), slope: 1, offset: 1 },
  'nested-functions': { build: (n) => 'function f(){'.repeat(n) + '}'.repeat(n), slope: 2, offset: 1 },
  'nested-callbacks': { build: (n) => 'a(function(){'.repeat(n) + '})'.repeat(n) + ';', slope: 4, offset: 1 },
  'nested-objects': { build: (n) => '(' + '{a:'.repeat(n) + '1' + '}'.repeat(n) + ');', slope: 2, offset: 3 },
  'unary-chain': { build: (n) => '!'.repeat(n) + 'a;', slope: 1, offset: 3 },
  'ternary-chain': { build: (n) => 'a?a:'.repeat(n) + 'a;', slope: 1, offset: 3 },
  'binary-chain': { build: (n) => 'a' + '+a'.repeat(n) + ';', slope: 1, offset: 3 },
} as const satisfies Record<string, Shape>;

export type ShapeName = keyof typeof SHAPES;
export const SHAPE_NAMES = Object.keys(SHAPES) as ShapeName[];

/** Nested parentheses build no node, so they only exercise the parser stack. */
export const nestedParentheses = (n: number): string => '('.repeat(n) + 'a' + ')'.repeat(n) + ';';

/** Levels that give exactly `depth` for a shape, or the nearest lower level when none does. */
export function levelsForDepth(shape: Shape, depth: number): number {
  return Math.max(0, Math.floor((depth - shape.offset) / shape.slope));
}
