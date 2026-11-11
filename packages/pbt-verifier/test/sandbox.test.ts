import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { UncloneableInputError } from '../src/sandbox/cloner.ts';
import {
  createSandbox,
  describeThrown,
  type Sandbox,
  type SandboxFunction,
} from '../src/sandbox/context.ts';

/** Reads a function that a script defined in the sandbox. */
function functionIn(sandbox: Sandbox, source: string): SandboxFunction {
  const value = sandbox.evaluate(`(${source})`, 'test-function.js', 1000);
  if (typeof value !== 'function') throw new Error('The script did not produce a function.');
  return value as SandboxFunction;
}

/** A sandbox-side function that changes every object it can reach, so a shared copy would show it. */
const DEEP_MUTATE = `function deepMutate(root) {
  var seen = [];
  function walk(o) {
    if (o === null || typeof o !== 'object' || seen.indexOf(o) >= 0) return;
    seen.push(o);
    var keys = Object.keys(o);
    for (var i = 0; i < keys.length; i++) walk(o[keys[i]]);
    if (Array.isArray(o)) o.push('mutated');
    else if (o instanceof Map) { o.forEach(function (v) { walk(v); }); o.set('mutated', 1); }
    else if (o instanceof Set) { o.forEach(walk); o.add('mutated'); }
    else if (o instanceof Date) o.setTime(0);
    else if (ArrayBuffer.isView(o)) o.reverse();
    else o.mutatedByLegacy = true;
  }
  walk(root);
  return root;
}`;

const supportedValue = fc.anything({
  withBigInt: true,
  withDate: true,
  withMap: true,
  withSet: true,
  withTypedArray: true,
  withSparseArray: true,
});

describe('createSandbox', () => {
  it('R3.5 R12.8 Property 9: require, process, fetch, and console are unreachable in every sandbox kind', () => {
    // Feature: 03-pbt-verifier, Property 9: Sandbox isolation
    const kinds: Array<() => Sandbox> = [
      () => createSandbox(),
      () => createSandbox({ exports: {} }),
    ];
    fc.assert(
      fc.property(
        fc.constantFrom(...kinds),
        fc.constantFrom(
          'require',
          'process',
          'fetch',
          'console',
          'Buffer',
          'setTimeout',
          'module',
          'WebAssembly',
        ),
        (makeSandbox, name) => {
          const sandbox = makeSandbox();
          expect(sandbox.evaluate(`typeof ${name}`, 'probe.js', 1000)).toBe('undefined');
          // The same names through the global object and through the Function constructor.
          expect(sandbox.evaluate(`typeof globalThis.${name}`, 'probe.js', 1000)).toBe('undefined');
          expect(
            sandbox.evaluate(`(function () {}).constructor('return typeof ${name}')()`, 'probe.js', 1000),
          ).toBe('undefined');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('R3.5 injects only the requested extra globals', () => {
    const sandbox = createSandbox({ exports: {} });
    expect(sandbox.evaluate('typeof exports', 'probe.js', 1000)).toBe('object');
    expect(createSandbox().evaluate('typeof exports', 'probe.js', 1000)).toBe('undefined');
  });

  it('R3.4 gives each sandbox its own globals', () => {
    const first = createSandbox();
    const second = createSandbox();
    first.evaluate('var shared = 1;', 'a.js', 1000);
    expect(second.evaluate('typeof shared', 'b.js', 1000)).toBe('undefined');
  });

  it('R4.3 propagates a syntax error and a top-level throw to the caller', () => {
    const sandbox = createSandbox();
    expect(() => sandbox.evaluate('function (', 'bad.js', 1000)).toThrow(SyntaxError);
    let thrown: unknown;
    try {
      sandbox.evaluate('throw new RangeError("boom");', 'throws.js', 1000);
    } catch (error) {
      thrown = error;
    }
    expect(describeThrown(thrown)).toBe('RangeError: boom');
  });

  it('R7.9 bounds a top-level infinite loop with the timeout', () => {
    const sandbox = createSandbox();
    expect(() => sandbox.evaluate('while (true) {}', 'loop.js', 30)).toThrow(/timed out/);
  });
});

describe('invoke', () => {
  it('R6.1 reports a returned value', () => {
    const sandbox = createSandbox();
    const double = functionIn(sandbox, 'function (x) { return x * 2; }');
    expect(sandbox.invoke(double, 21, 1000)).toEqual({ kind: 'returned', value: 42 });
  });

  it.each([
    ['an Error', 'throw new TypeError("x");', 'TypeError'],
    ['a RangeError from the engine', 'null.property;', 'TypeError'],
    ['an object with a string name', 'throw { name: "Custom" };', 'Custom'],
    ['a string', 'throw "boom";', 'non-error'],
    ['a number', 'throw 7;', 'non-error'],
    ['null', 'throw null;', 'non-error'],
    ['an object whose name is not a string', 'throw { name: 5 };', 'non-error'],
    ['an object without a name', 'throw {};', 'non-error'],
    ['an object whose name getter throws', 'throw { get name() { throw 1; } };', 'non-error'],
    [
      'an object imitating the timeout error',
      'throw { code: "ERR_SCRIPT_EXECUTION_TIMEOUT", name: "Error" };',
      'Error',
    ],
  ])('R6.2 reports %s as a throw with name %s', (_label, body, expectedName) => {
    const sandbox = createSandbox();
    const fn = functionIn(sandbox, `function () { ${body} }`);
    expect(sandbox.invoke(fn, undefined, 1000)).toEqual({ kind: 'threw', name: expectedName });
  });

  it('R7.9 returns "timeout" for an infinite loop within the limit, and the sandbox stays usable', () => {
    const sandbox = createSandbox();
    const spin = functionIn(sandbox, 'function () { while (true) {} }');
    const started = performance.now();
    expect(sandbox.invoke(spin, undefined, 50)).toEqual({ kind: 'timeout' });
    expect(performance.now() - started).toBeLessThan(5000);
    const add = functionIn(sandbox, 'function (x) { return x + 1; }');
    expect(sandbox.invoke(add, 1, 1000)).toEqual({ kind: 'returned', value: 2 });
  });

  it('R7.9 a try/catch in user code cannot swallow a timeout', () => {
    const sandbox = createSandbox();
    const spin = functionIn(
      sandbox,
      'function () { try { while (true) {} } catch (e) { return "swallowed"; } }',
    );
    expect(sandbox.invoke(spin, undefined, 50)).toEqual({ kind: 'timeout' });
  });

  it('R3.5 leaves no private binding behind after a call', () => {
    const sandbox = createSandbox();
    const noop = functionIn(sandbox, 'function () { return 1; }');
    sandbox.invoke(noop, undefined, 1000);
    expect(sandbox.evaluate('typeof __lazarus_fn__ + typeof __lazarus_in__', 'probe.js', 1000)).toBe(
      'undefinedundefined',
    );
    const spin = functionIn(sandbox, 'function () { while (true) {} }');
    sandbox.invoke(spin, undefined, 30);
    expect(sandbox.evaluate('typeof __lazarus_fn__ + typeof __lazarus_in__', 'probe.js', 1000)).toBe(
      'undefinedundefined',
    );
  });
});

describe('cloneInto', () => {
  it('R6.7 the copy belongs to the sandbox realm, so instanceof Array behaves as in a native runtime', () => {
    const sandbox = createSandbox();
    const isArray = functionIn(sandbox, 'function (x) { return x instanceof Array; }');
    const hostArray = [1, [2, 3]];
    // Native runtime reference.
    expect(hostArray instanceof Array).toBe(true);
    // A host value passed as is fails the legacy check; the copy passes it.
    expect(sandbox.invoke(isArray, hostArray, 1000)).toEqual({ kind: 'returned', value: false });
    expect(sandbox.invoke(isArray, sandbox.cloneInto(hostArray), 1000)).toEqual({
      kind: 'returned',
      value: true,
    });
    const nested = functionIn(sandbox, 'function (x) { return x[1] instanceof Array; }');
    expect(sandbox.invoke(nested, sandbox.cloneInto(hostArray), 1000)).toEqual({
      kind: 'returned',
      value: true,
    });
  });

  it('R6.7 preserves NaN, -0, infinities, bigint, holes, shared references, and cycles', () => {
    const sandbox = createSandbox();
    const inspect = functionIn(
      sandbox,
      `function (x) {
        return [
          x.nan !== x.nan,
          Object.is(x.negZero, -0),
          x.inf === Infinity,
          typeof x.big === 'bigint' && x.big === 12345678901234567890n,
          x.holes.length === 4 && !(1 in x.holes) && (2 in x.holes),
          x.a === x.b,
          x.self === x,
          x.date instanceof Date && x.date.getTime() === 86400000,
          x.re instanceof RegExp && x.re.source === 'a+' && x.re.flags === 'gi',
          x.map instanceof Map && x.map.get('k') === 1,
          x.set instanceof Set && x.set.has('s'),
          x.typed instanceof Uint8Array && x.typed[1] === 2
        ];
      }`,
    );
    const shared = { n: 1 };
    const input: Record<string, unknown> = {
      nan: Number.NaN,
      negZero: -0,
      inf: Number.POSITIVE_INFINITY,
      big: 12345678901234567890n,
      holes: [1, , 3, 4],
      a: shared,
      b: shared,
      date: new Date(86400000),
      re: /a+/gi,
      map: new Map([['k', 1]]),
      set: new Set(['s']),
      typed: new Uint8Array([1, 2, 3]),
    };
    input.self = input;
    const result = sandbox.invoke(inspect, sandbox.cloneInto(input), 1000);
    if (result.kind !== 'returned') throw new Error(`Unexpected ${result.kind}`);
    const flags = result.value as boolean[];
    expect(Array.from(flags)).toEqual(new Array(12).fill(true));
  });

  it('R6.7 keeps an own "__proto__" key as data and does not change the prototype', () => {
    const sandbox = createSandbox();
    const payload: unknown = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}');
    const inspect = functionIn(
      sandbox,
      `function (x) {
        return Object.getPrototypeOf(x) === Object.prototype &&
          x.polluted === undefined && Object.keys(x).join() === '__proto__,ok';
      }`,
    );
    expect(sandbox.invoke(inspect, sandbox.cloneInto(payload), 1000)).toEqual({
      kind: 'returned',
      value: true,
    });
  });

  it('R6.7 Property 5: mutating the copy of one sandbox never changes the original or the other copy', () => {
    // Feature: 03-pbt-verifier, Property 5: Clone isolation
    const legacy = createSandbox();
    const modern = createSandbox();
    const mutate = functionIn(legacy, DEEP_MUTATE);
    fc.assert(
      fc.property(supportedValue, (value) => {
        const originalBefore = fc.stringify(value);
        const legacyCopy = legacy.cloneInto(value);
        const modernCopy = modern.cloneInto(value);
        const modernBefore = fc.stringify(modernCopy);

        const outcome = legacy.invoke(mutate, legacyCopy, 1000);
        expect(outcome.kind).toBe('returned');

        expect(fc.stringify(value)).toBe(originalBefore);
        expect(fc.stringify(modernCopy)).toBe(modernBefore);
      }),
      { numRuns: 200 },
    );
  });

  it('R12.7 mutation of a nested object by the legacy side is visible only in its own copy', () => {
    const legacy = createSandbox();
    const modern = createSandbox();
    const mutate = functionIn(legacy, DEEP_MUTATE);
    const input = { items: [{ n: 1 }, { n: 2 }], label: 'x' };
    const legacyCopy = legacy.cloneInto(input);
    const modernCopy = modern.cloneInto(input);
    legacy.invoke(mutate, legacyCopy, 1000);
    const read = functionIn(modern, 'function (x) { return x.items.length + ":" + x.items[0].mutatedByLegacy; }');
    expect(modern.invoke(read, modernCopy, 1000)).toEqual({ kind: 'returned', value: '2:undefined' });
    expect(input).toEqual({ items: [{ n: 1 }, { n: 2 }], label: 'x' });
    const readLegacy = functionIn(legacy, 'function (x) { return x.items.length + ":" + x.items[0].mutatedByLegacy; }');
    expect(legacy.invoke(readLegacy, legacyCopy, 1000)).toEqual({ kind: 'returned', value: '3:true' });
  });

  it('R6.8 rejects values that cannot be deep-copied with UncloneableInputError', () => {
    const sandbox = createSandbox();
    class Point {
      x = 1;
    }
    class Dictionary extends Map<string, number> {}
    const cases: unknown[] = [
      () => 1,
      Symbol('s'),
      new Point(),
      new Dictionary(),
      Buffer.from('abc'),
      new ArrayBuffer(4),
      new DataView(new ArrayBuffer(4)),
      Promise.resolve(1),
      new Error('e'),
      new Number(1),
      { nested: { fn: () => 2 } },
      [Symbol('in-array')],
      Object.create({ inherited: 1 }),
    ];
    for (const value of cases) {
      expect(() => sandbox.cloneInto(value)).toThrow(UncloneableInputError);
    }
    expect(() => sandbox.cloneInto(() => 1)).toThrow(/structured-cloneable/);
  });

  it('R6.7 accepts null-prototype objects and primitives', () => {
    const sandbox = createSandbox();
    expect(sandbox.cloneInto(null)).toBeNull();
    expect(sandbox.cloneInto('text')).toBe('text');
    expect(sandbox.cloneInto(undefined)).toBeUndefined();
    const bare = Object.assign(Object.create(null) as Record<string, number>, { a: 1 });
    const read = functionIn(sandbox, 'function (x) { return x.a; }');
    expect(sandbox.invoke(read, sandbox.cloneInto(bare), 1000)).toEqual({ kind: 'returned', value: 1 });
  });
});

describe('describeThrown', () => {
  it('R4.3 R5.5 renders name and message, truncates, and never throws', () => {
    expect(describeThrown(new TypeError('bad'))).toBe('TypeError: bad');
    expect(describeThrown({ name: 'Custom' })).toBe('Custom');
    expect(describeThrown('text')).toBe('Non-error value thrown: text');
    expect(describeThrown(new Error('x'.repeat(2000))).length).toBeLessThanOrEqual(503);
    const hostile = {
      get name(): string {
        throw new Error('no');
      },
    };
    expect(describeThrown(hostile)).toMatch(/cannot be described/);
    expect(describeThrown(Object.create(null) as object)).toBe('Error');
  });

  it('R2.9 R9.5 does not include a stack trace', () => {
    const error = new Error('boom');
    expect(describeThrown(error)).not.toContain('at ');
    expect(describeThrown(error)).not.toContain('.ts:');
  });
});
