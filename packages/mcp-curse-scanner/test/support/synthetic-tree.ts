import { createLineIndex, type LineIndex } from '../../src/scanner/line-index.ts';
import type { TreeNode } from '../../src/scanner/visit.ts';

export interface SyntheticTree {
  tree: TreeNode;
  lineIndex: LineIndex;
}

const SOURCE = 'a';

const node = (type: string, extra: Record<string, unknown> = {}): TreeNode => ({
  type,
  start: 0,
  end: SOURCE.length,
  ...extra,
});

/** Program -> ExpressionStatement -> MemberExpression x (depth - 3) -> Identifier. Built iteratively. */
export function makeChainTree(depth: number): SyntheticTree {
  let expression = node('Identifier', { name: 'a' });
  for (let level = 0; level < depth - 3; level++) {
    expression = node('MemberExpression', {
      object: expression,
      property: node('Identifier', { name: 'a' }),
      computed: false,
    });
  }
  const statement = node('ExpressionStatement', { expression });
  return { tree: node('Program', { body: [statement] }), lineIndex: createLineIndex(SOURCE) };
}

/** A Program with `nodes - 1` EmptyStatement children, so exactly `nodes` nodes and depth 2. */
export function makeFlatTree(nodes: number): SyntheticTree {
  const body: TreeNode[] = [];
  for (let i = 0; i < nodes - 1; i++) body.push(node('EmptyStatement'));
  return { tree: node('Program', { body }), lineIndex: createLineIndex(SOURCE) };
}
