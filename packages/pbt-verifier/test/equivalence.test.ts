import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { deepEquivalent } from '../src/equivalence/deep-equivalent.ts';
import {
  equivalentOutcomes,
  renderOutcome,
  truncate,
  type Outcome,
} from '../src/equivalence/outcome.ts';
import { createSandbox } from '../src/sandbox/context.ts';

const sandbox = createSandbox();

/** Evaluates an expression in the sandbox realm and returns the value it creates there. */
function inSandbox(expression: string): unknown {
  return sandbox.evaluate(`(${expression})`, 'expression.js', 1000);
}

const supportedValue = fc.anything({
  withBigInt: true,
  withDate: true,
  withMap: true,
  withSet: true,
  withTypedArray: true,
  withSparseArray: true,
});

const returned = (value: unknown): Outcome => ({ kind: 'returned', value });
const threw = (name: string): Outcome => ({ kind: 'threw', name });

describe('deepEquivalent', () => {
  it('R6.3 Property 4: is reflexive, symmetric, and true for a copy made in another realm', () => {
    // Feature: 03-pbt-verifier, Property 4: Comparison is an equivalence relation
    fc.assert(
      fc.property(supportedValue, supportedValue, (a, b) => {
        expect(deepEquivalent(a, a)).toBe(true);
        expect(deepEquivalent(a, b)).toBe(deepEquivalent(b, a));
        expect(deepEquivalent(a, sandbox.cloneInto(a))).toBe(true);
        expect(deepEquivalent(sandbox.cloneInto(a), a)).toBe(true);
        expect(deepEquivalent(sandbox.cloneInto(a), sandbox.cloneInto(a))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('R6.3 Property 4 (separation): a change anywhere in the value is detected', () => {
    // Feature: 03-pbt-verifier, Supporting check: deepEquivalent separates different values
    fc.assert(
      fc.property(fc.array(fc.integer(), { minLength: 1, maxLength: 8 }), fc.nat(), (items, pick) => {
        const copy = sandbox.cloneInto({ list: items, label: 'x' }) as { list: number[] };
        expect(deepEquivalent({ list: items, label: 'x' }, copy)).toBe(true);
        const index = pick % items.length;
        copy.list[index] = items[index] + 1;
        expect(deepEquivalent({ list: items, label: 'x' }, copy)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('R6.3 treats NaN as equal to NaN, also inside containers', () => {
    expect(deepEquivalent(Number.NaN, Number.NaN)).toBe(true);
    expect(deepEquivalent([Number.NaN], [Number.NaN])).toBe(true);
    expect(deepEquivalent({ a: Number.NaN }, { a: Number.NaN })).toBe(true);
  });

  it('R6.3 treats +0 and -0 as different, also inside containers', () => {
    expect(deepEquivalent(0, -0)).toBe(false);
    expect(deepEquivalent(-0, -0)).toBe(true);
    expect(deepEquivalent([0], [-0])).toBe(false);
    expect(deepEquivalent({ a: 0 }, { a: -0 })).toBe(false);
    expect(deepEquivalent(new Float64Array([0]), new Float64Array([-0]))).toBe(false);
  });

  it('R6.3 does not depend on the realm of arrays, plain objects, Date, RegExp, Map, and Set', () => {
    const pairs: Array<[unknown, string]> = [
      [[1, [2, 3]], '[1, [2, 3]]'],
      [{ a: 1, b: { c: [true] } }, '({ a: 1, b: { c: [true] } })'],
      [new Date(1000), 'new Date(1000)'],
      [/a+/gi, '/a+/gi'],
      [new Map([['k', [1]]]), "new Map([['k', [1]]])"],
      [new Set([1, 'two']), "new Set([1, 'two'])"],
      [new Uint8Array([1, 2]), 'new Uint8Array([1, 2])'],
      [Object.create(null) as object, 'Object.create(null)'],
      [new Error('e'), "new Error('e')"],
    ];
    for (const [host, expression] of pairs) {
      expect(deepEquivalent(host, inSandbox(expression)), expression).toBe(true);
      expect(deepEquivalent(inSandbox(expression), host), expression).toBe(true);
    }
  });

  it('R6.3 distinguishes values of the same shape', () => {
    expect(deepEquivalent(new Date(1), new Date(2))).toBe(false);
    expect(deepEquivalent(new Date(Number.NaN), new Date(Number.NaN))).toBe(true);
    expect(deepEquivalent(/a/g, /a/i)).toBe(false);
    expect(deepEquivalent(/a/g, /b/g)).toBe(false);
    expect(deepEquivalent(new Map([[1, 'a']]), new Map([[1, 'b']]))).toBe(false);
    expect(deepEquivalent(new Map([[1, 'a'], [2, 'b']]), new Map([[2, 'b'], [1, 'a']]))).toBe(false);
    expect(deepEquivalent(new Set([1]), new Set([2]))).toBe(false);
    expect(deepEquivalent(new Uint8Array([1]), new Int8Array([1]))).toBe(false);
    expect(deepEquivalent(new Uint8Array([1, 2]), new Uint8Array([1]))).toBe(false);
    expect(deepEquivalent([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEquivalent({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEquivalent({ a: 1 }, { b: 1 })).toBe(false);
    expect(deepEquivalent([], {})).toBe(false);
    expect(deepEquivalent(null, undefined)).toBe(false);
    expect(deepEquivalent(null, {})).toBe(false);
    expect(deepEquivalent(1, '1')).toBe(false);
    expect(deepEquivalent(1n, 1)).toBe(false);
    expect(deepEquivalent(1n, 1n)).toBe(true);
    expect(deepEquivalent(new Error('a'), new Error('b'))).toBe(false);
    expect(deepEquivalent(new TypeError('a'), new RangeError('a'))).toBe(false);
  });

  it('R6.3 tells array holes from undefined values and compares boxed primitives by value', () => {
    expect(deepEquivalent([, 1], [undefined, 1])).toBe(false);
    expect(deepEquivalent([, 1], [, 1])).toBe(true);
    expect(deepEquivalent(Object(1), Object(1))).toBe(true);
    expect(deepEquivalent(Object(1), Object(2))).toBe(false);
    expect(deepEquivalent(Object('a'), Object('b'))).toBe(false);
    expect(deepEquivalent(Object(true), Object(false))).toBe(false);
  });

  it('R6.3 ignores prototypes and compares class instances by their own properties', () => {
    class Point {
      constructor(
        public x: number,
        public y: number,
      ) {}
    }
    expect(deepEquivalent(new Point(1, 2), { x: 1, y: 2 })).toBe(true);
    expect(deepEquivalent(new Point(1, 2), { x: 1, y: 3 })).toBe(false);
  });

  it('R6.6 compares functions and symbols by typeof only', () => {
    expect(deepEquivalent(() => 1, () => 2)).toBe(true);
    expect(deepEquivalent(function named() {}, () => 2)).toBe(true);
    expect(deepEquivalent(Symbol('a'), Symbol('b'))).toBe(true);
    expect(deepEquivalent(() => 1, Symbol('a'))).toBe(false);
    expect(deepEquivalent(() => 1, {})).toBe(false);
    expect(deepEquivalent({ f: () => 1 }, { f: () => 2 })).toBe(true);
  });

  it('R6.3 terminates on cycles and still detects a difference inside one', () => {
    const a: Record<string, unknown> = { n: 1 };
    a.self = a;
    const b: Record<string, unknown> = { n: 1 };
    b.self = b;
    expect(deepEquivalent(a, b)).toBe(true);
    const c: Record<string, unknown> = { n: 2 };
    c.self = c;
    expect(deepEquivalent(a, c)).toBe(false);
    const x: unknown[] = [1];
    x.push(x);
    const y: unknown[] = [1];
    y.push(y);
    expect(deepEquivalent(x, y)).toBe(true);
  });

  it('R6.3 never reaches the prototype chain of the compared values', () => {
    const left = inSandbox('Object.create({ inherited: 1 })');
    const right = Object.create({ inherited: 2 }) as object;
    expect(deepEquivalent(left, right)).toBe(true);
  });
});

describe('equivalentOutcomes', () => {
  it('R6.4 treats two throws with the same name and different messages as equivalent', () => {
    expect(equivalentOutcomes(threw('TypeError'), threw('TypeError'))).toBe(true);
    expect(equivalentOutcomes(threw('TypeError'), threw('RangeError'))).toBe(false);
  });

  it('R6.5 never treats a returned value as equivalent to a thrown value', () => {
    expect(equivalentOutcomes(returned(1), threw('Error'))).toBe(false);
    expect(equivalentOutcomes(threw('Error'), returned(1))).toBe(false);
    expect(equivalentOutcomes(returned('Error'), threw('Error'))).toBe(false);
    expect(equivalentOutcomes(returned(undefined), threw('non-error'))).toBe(false);
  });

  it('R6.3 compares returned values structurally', () => {
    expect(equivalentOutcomes(returned([Number.NaN]), returned([Number.NaN]))).toBe(true);
    expect(equivalentOutcomes(returned(0), returned(-0))).toBe(false);
  });

  it('R6.6 compares returned functions by typeof only', () => {
    expect(equivalentOutcomes(returned(() => 1), returned(() => 2))).toBe(true);
    expect(equivalentOutcomes(returned(() => 1), returned(2))).toBe(false);
  });

  it('R6.9 treats a returned Promise as an ordinary object and does not await it', () => {
    expect(equivalentOutcomes(returned(Promise.resolve(1)), returned(Promise.resolve(2)))).toBe(true);
  });
});

describe('renderOutcome', () => {
  it('R9.1 names the kind and the value or the error name', () => {
    expect(renderOutcome(returned({ a: [1, 'x'] }))).toBe('returned: {"a":[1,"x"]}');
    expect(renderOutcome(returned(-0))).toBe('returned: -0');
    expect(renderOutcome(returned(undefined))).toBe('returned: undefined');
    expect(renderOutcome(threw('TypeError'))).toBe('threw: TypeError');
  });

  it('R9.1 renders values created in another realm', () => {
    expect(renderOutcome(returned(inSandbox('[1, { a: new Map([[1, 2]]) }]')))).toBe(
      'returned: [1,{"a":new Map([[1,2]])}]',
    );
  });

  it('R9.1 truncates to 500 characters', () => {
    const text = renderOutcome(returned('x'.repeat(5000)));
    expect(text.length).toBe(500);
    expect(text.endsWith('...')).toBe(true);
    expect(renderOutcome(threw('N'.repeat(900))).length).toBe(500);
  });

  it('R2.8 renders a value that cannot be printed without throwing', () => {
    const hostile = {
      toString(): string {
        throw new Error('no');
      },
      toJSON(): never {
        throw new Error('no');
      },
    };
    expect(() => renderOutcome(returned(hostile))).not.toThrow();
  });
});

describe('truncate', () => {
  it('R9.1 keeps short text and cuts long text to the limit', () => {
    expect(truncate('abc', 10)).toBe('abc');
    expect(truncate('abcdefghij', 10)).toBe('abcdefghij');
    expect(truncate('abcdefghijk', 10)).toBe('abcdefg...');
  });
});
