import fc from 'fast-check';
import type { CurseType } from '../../src/lib.ts';
import { INJECTABLE_SNIPPETS, type InjectableSnippet } from './curse-corpus.ts';

export interface RenderedProgram {
  lines: string[];
  /** Line indexes (0..lines.length) where no block is open, so a statement can be inserted. */
  topLevelBoundaries: number[];
}

type Block = 'function' | 'block' | 'callback';

const MAX_FUNCTION_NESTING = 4;
const MAX_BLOCK_NESTING = 4;
const MAX_CALLBACK_NESTING = 2;

// Renders an ES5 program from a random tape. One complete statement or block opener or closer
// per line. Identifier pools are f<n>, p<n>, and m<n>. Every function takes (p0, p1), so any
// assignment to p0 or p1 targets the innermost function's own parameter.
export function renderProgram(tape: readonly number[]): RenderedProgram {
  const lines: string[] = [];
  const stack: Block[] = [];
  const boundaries = [0];
  const count = (kind: Block): number => stack.filter((block) => block === kind).length;
  const functions = (): number => count('function') + count('callback');

  const emit = (line: string): void => {
    lines.push(line);
  };
  // Called after each operation, when the block stack already reflects the emitted line.
  const markBoundary = (): void => {
    if (stack.length === 0 && boundaries[boundaries.length - 1] !== lines.length) boundaries.push(lines.length);
  };
  const close = (): void => {
    const block = stack.pop();
    emit(block === 'callback' ? '});' : '}');
  };

  for (const value of tape) {
    const name = value % 5;
    if (value < 15) {
      if (functions() < MAX_FUNCTION_NESTING) {
        emit(`function f${name}(p0, p1) {`);
        stack.push('function');
      }
    } else if (value < 30) {
      if (count('block') < MAX_BLOCK_NESTING) {
        emit('if (p0 === p1) {');
        stack.push('block');
      }
    } else if (value < 40) {
      if (count('callback') < MAX_CALLBACK_NESTING && functions() < MAX_FUNCTION_NESTING) {
        emit(`f${name}(function (p0, p1) {`);
        stack.push('callback');
      }
    } else if (value < 55) {
      if (stack.length > 0) close();
    } else if (value < 70) {
      emit(functions() > 0 ? 'p0 = p1 + 1;' : `m${name}.m1 = 1;`);
    } else if (value < 80) {
      emit(`m${name}.m1(p0);`);
    } else if (value < 90) {
      emit(`f${name}(p1);`);
    } else {
      emit(functions() > 0 ? 'return p0;' : `m1.m2 = m${name};`);
    }
    markBoundary();
  }
  while (stack.length > 0) close();
  // A tape of operations that emit nothing would give an empty source; a program has a line.
  if (lines.length === 0) emit('m0.m1 = 1;');
  markBoundary();
  return { lines, topLevelBoundaries: boundaries };
}

export const programTape = fc.array(fc.integer({ min: 0, max: 99 }), { minLength: 1, maxLength: 170 });

/** Clean_Corpus: ES5 programs of 1 to 200 lines without any curse or impurity marker. */
export const cleanProgram: fc.Arbitrary<RenderedProgram> = programTape.map(renderProgram);

export interface InjectedProgram {
  source: string;
  lines: string[];
  expected: { curseType: CurseType; lineNumber: number; column: number }[];
}

const CURSE_ORDER: CurseType[] = [
  'GLOBAL_POLLUTION',
  'VAR_HOISTING',
  'IMPLICIT_COERCION',
  'CALLBACK_HELL',
  'EVAL_INJECTION',
  'PROTOTYPE_POLLUTION',
];

/** Inserts snippets at top-level boundaries and computes the findings they must produce. */
export function inject(program: RenderedProgram, picks: readonly (readonly [number, InjectableSnippet])[]): InjectedProgram {
  const boundaries = program.topLevelBoundaries;
  const placed = picks
    .map(([raw, snippet], order) => ({ boundary: boundaries[raw % boundaries.length]!, snippet, order }))
    .sort((a, b) => a.boundary - b.boundary || a.order - b.order);

  const lines: string[] = [];
  const expected: InjectedProgram['expected'] = [];
  let next = 0;
  const emitSnippetsAt = (boundary: number): void => {
    while (next < placed.length && placed[next]!.boundary === boundary) {
      const { snippet } = placed[next]!;
      lines.push(snippet.source);
      for (const finding of snippet.expected) {
        expected.push({ curseType: finding.curseType, lineNumber: lines.length, column: finding.column });
      }
      next++;
    }
  };
  for (let index = 0; index <= program.lines.length; index++) {
    emitSnippetsAt(index);
    if (index < program.lines.length) lines.push(program.lines[index]!);
  }
  expected.sort(
    (a, b) => a.lineNumber - b.lineNumber || a.column - b.column || CURSE_ORDER.indexOf(a.curseType) - CURSE_ORDER.indexOf(b.curseType),
  );
  return { source: lines.join('\n'), lines, expected };
}

export const injectionPicks = fc.array(fc.tuple(fc.nat(), fc.constantFrom(...INJECTABLE_SNIPPETS)), { maxLength: 3 });

/** Programs with 0 to 3 injected snippets at top-level boundaries. */
export const injectedProgram: fc.Arbitrary<InjectedProgram> = fc
  .tuple(cleanProgram, injectionPicks)
  .map(([program, picks]) => inject(program, picks));
