import * as acorn from 'acorn';
import { describe, expect, it } from 'vitest';
import { CHILD_KEYS } from '../../src/scanner/child-keys.ts';
import { CURSE_CORPUS } from '../support/curse-corpus.ts';

interface Node {
  type: string;
  [key: string]: unknown;
}

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';

// Generic, iterative walk over every object that has a string `type`.
function allNodes(root: Node): Node[] {
  const nodes: Node[] = [];
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    nodes.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const item of value) if (isNode(item)) stack.push(item);
      if (isNode(value)) stack.push(value);
    }
  }
  return nodes;
}

describe('child keys table', () => {
  const programs = [
    ...CURSE_CORPUS.map((testCase) => testCase.source),
    'switch (a) { case 1: b(); break; default: c(); }',
    'try { a(); } catch (e) { b(); } finally { c(); }',
    'with (o) { x = 1; }',
    'outer: for (var i = 0; i < 3; i++) { continue outer; }',
    'do { a(); } while (b); while (c) { d(); } if (x) y(); else z();',
    'var o = { get a() { return 1; }, set a(v) {}, "b": [1, , 2] }; x = a ? b : c, d;',
    'debugger; new A; typeof a; delete b.c; a in b; a instanceof B; this.x = /re/g.test(s);',
  ];

  it('R12.3 covers every node type and child key that acorn produces for sample programs', () => {
    for (const source of programs) {
      let tree: Node;
      try {
        tree = acorn.parse(source, { ecmaVersion: 5, allowReturnOutsideFunction: true }) as unknown as Node;
      } catch {
        continue;
      }
      for (const node of allNodes(tree)) {
        const keys = CHILD_KEYS[node.type];
        expect(keys, `node type ${node.type} is missing from CHILD_KEYS`).toBeDefined();
        for (const [key, value] of Object.entries(node)) {
          const holdsNode = isNode(value) || (Array.isArray(value) && value.some(isNode));
          if (holdsNode) expect(keys, `${node.type}.${key} is not a listed child key`).toContain(key);
        }
      }
    }
  });
});
