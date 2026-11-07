import { describe, expect, it } from 'vitest';
import { createDeadline } from '../../src/scanner/deadline.ts';
import { analyzeTree } from '../../src/scanner/visit.ts';
import { makeChainTree, makeFlatTree } from '../support/synthetic-tree.ts';

const run = (built: ReturnType<typeof makeChainTree>) =>
  analyzeTree(built.tree, built.lineIndex, createDeadline());

describe('analyzeTree limits', () => {
  it('R12.3 a chain of depth 512 is accepted (mode: synthetic)', () => {
    expect(run(makeChainTree(512)).ok).toBe(true);
  });

  it('R12.3 a chain of depth 513 gives LIMIT_EXCEEDED (mode: synthetic)', () => {
    expect(run(makeChainTree(513))).toMatchObject({ ok: false, code: 'LIMIT_EXCEEDED' });
  });

  it('R12.3 a chain of 100,000 levels gives LIMIT_EXCEEDED without a stack error (mode: synthetic)', () => {
    expect(run(makeChainTree(100_000))).toMatchObject({ ok: false, code: 'LIMIT_EXCEEDED' });
  });

  it('R12.3 a flat tree of exactly 200,000 nodes is accepted (mode: synthetic)', () => {
    expect(run(makeFlatTree(200_000)).ok).toBe(true);
  });

  it('R12.3 a flat tree of 200,001 nodes gives LIMIT_EXCEEDED (mode: synthetic)', () => {
    expect(run(makeFlatTree(200_001))).toMatchObject({ ok: false, code: 'LIMIT_EXCEEDED' });
  });

  it('R12.4 an expired deadline gives TIMEOUT and no lists (mode: synthetic)', () => {
    let time = 0;
    const deadline = createDeadline({
      now: () => {
        const value = time;
        time += 6_000;
        return value;
      },
      timeBudgetMs: 5_000,
    });
    const { tree, lineIndex } = makeChainTree(10);
    const outcome = analyzeTree(tree, lineIndex, deadline);
    expect(outcome).toMatchObject({ ok: false, code: 'TIMEOUT' });
    expect(outcome).not.toHaveProperty('curses');
    expect(outcome).not.toHaveProperty('functions');
  });

  it('R12.3 an unknown node type is an internal failure and not a silent success (mode: synthetic)', () => {
    const { tree, lineIndex } = makeChainTree(5);
    (tree as { type: string }).type = 'FutureNode';
    expect(() => analyzeTree(tree, lineIndex, createDeadline())).toThrow();
  });
});
