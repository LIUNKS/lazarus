import { deepEquivalent } from '@lazarus/pbt-verifier/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { encodeInput } from '../src/host/tagged-value.ts';
import { DEFAULT_MAX_BYTES, loadCodec } from './support/codec.ts';

const codec = loadCodec();
const other = loadCodec();
const canonical = (value: unknown): string => codec.encode(value, DEFAULT_MAX_BYTES);

// Values of the supported types (Requirement 7, criterion 2), without functions and symbols.
const leaf = fc.oneof(
  fc.constantFrom<unknown>(undefined, null, true, false, 0, -0, NaN, Infinity, -Infinity, '', '$', '__proto__'),
  fc.integer(),
  fc.double(),
  fc.string({ maxLength: 12 }),
  fc.bigInt({ min: -(2n ** 70n), max: 2n ** 70n }),
  fc.date({ noInvalidDate: false }),
  fc.constantFrom<unknown>(/a+b/gi, /x/, new RegExp('[a-z]\\d', 'm')),
  fc.tuple(fc.constantFrom('Error', 'TypeError', 'RangeError', 'CustomError'), fc.string({ maxLength: 8 })).map(([name, message]) => {
    const error = new Error(message);
    error.name = name;
    return error;
  }),
  fc.uint8Array({ maxLength: 6 }),
  fc.float64Array({ maxLength: 4 }),
  fc.bigInt64Array({ maxLength: 3 }),
);

const key = fc.oneof(fc.string({ maxLength: 6 }), fc.constantFrom('__proto__', 'constructor', '$', 'toString', '0', 'length'));

const supported: fc.Arbitrary<unknown> = fc.letrec<{ value: unknown }>((tie) => ({
  value: fc.oneof(
    { maxDepth: 4, withCrossShrink: true },
    leaf,
    fc.array(tie('value'), { maxLength: 4 }),
    fc.sparseArray(tie('value'), { maxNumElements: 3, maxLength: 6 }),
    fc.array(fc.tuple(key, tie('value')), { maxLength: 4 }).map((entries) => {
      const object: Record<string, unknown> = {};
      for (const [name, item] of entries) Object.defineProperty(object, name, { value: item, enumerable: true, writable: true, configurable: true });
      return object;
    }),
    fc.array(fc.tuple(tie('value'), tie('value')), { maxLength: 3 }).map((entries) => new Map(entries)),
    fc.array(tie('value'), { maxLength: 3 }).map((items) => new Set(items)),
  ),
})).value;

describe('value codec', () => {
  it('R7.9 decoding an encoding gives a value with the same canonical form, independent of the original', () => {
    // Feature: 07-sandboxed-execution, Property 1: Codec round trip
    fc.assert(
      fc.property(supported, (value) => {
        const text = canonical(value);
        const before = text;
        const copy = codec.decode(text);
        if (canonical(copy) !== text) return false;
        // Mutating the decoded copy must not change the original.
        if (typeof copy === 'object' && copy !== null) {
          Object.defineProperty(copy, 'lzMutation', { value: 1, enumerable: true, configurable: true });
          if (Array.isArray(copy)) copy.length = 0;
        }
        return canonical(value) === before;
      }),
      { numRuns: 300 },
    );
  });

  it('R8.5 two values have equal canonical forms exactly when the Verifier calls them equivalent', () => {
    // Feature: 07-sandboxed-execution, Property 2: Agreement with the Verifier
    const pair = fc.oneof(
      fc.tuple(supported, supported),
      // A value and a structurally equal copy built in another context.
      supported.map((value) => [value, other.decode(other.encode(value, DEFAULT_MAX_BYTES))] as [unknown, unknown]),
      fc.constantFrom<[unknown, unknown]>([0, -0], [NaN, NaN], [[1, , 3], [1, undefined, 3]], [{ a: 1, b: 2 }, { b: 2, a: 1 }], [new Map([[1, 2]]), new Map([[1, 3]])]),
    );
    fc.assert(
      fc.property(pair, ([left, right]) => (canonical(left) === canonical(right)) === deepEquivalent(left, right)),
      { numRuns: 400 },
    );
  });

  it('R8.3 a shared reference and a duplicated one have the same canonical form', () => {
    const shared = { a: [1, 2] };
    expect(canonical([shared, shared])).toBe(canonical([{ a: [1, 2] }, { a: [1, 2] }]));
    expect(deepEquivalent([shared, shared], [{ a: [1, 2] }, { a: [1, 2] }])).toBe(true);
  });

  it('R7.2 the host encoder writes the same text as the Trusted_Script encoder', () => {
    // Feature: 07-sandboxed-execution, Supporting check: Host and in-context encoders agree
    fc.assert(
      fc.property(supported, (value) => {
        const host = encodeInput(value, DEFAULT_MAX_BYTES);
        return host.ok && host.text === canonical(value);
      }),
      { numRuns: 300 },
    );
  });

  it('R4.10 a decoded value is built with the constructors of its own context', () => {
    const decoded = codec.decode(canonical({ list: [1], when: new Date(0), map: new Map(), error: new TypeError('x') })) as Record<string, unknown>;
    expect(codec.evaluate('Array')).not.toBe(Array);
    expect(decoded.list).toBeInstanceOf(codec.evaluate('Array') as typeof Array);
    expect(decoded.when).toBeInstanceOf(codec.evaluate('Date') as typeof Date);
    expect(decoded.map).toBeInstanceOf(codec.evaluate('Map') as typeof Map);
    expect(decoded.error).toBeInstanceOf(codec.evaluate('TypeError') as typeof TypeError);
    expect(Object.getPrototypeOf(decoded)).toBe(codec.evaluate('Object.prototype'));
  });

  it('R7.8 a key named __proto__ becomes an ordinary own property and no prototype changes', () => {
    const source = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}') as object;
    const decoded = codec.decode(canonical(source)) as Record<string, unknown>;
    expect(Object.getOwnPropertyNames(decoded).sort()).toEqual(['__proto__', 'a']);
    expect(Object.getPrototypeOf(decoded)).toBe(codec.evaluate('Object.prototype'));
    expect(codec.evaluate('({}).polluted')).toBeUndefined();
  });

  it('R6.6 the codec keeps working after its context has tampered intrinsics', () => {
    const tampered = loadCodec();
    tampered.evaluate(`
      Object.keys = function () { return ['forged']; };
      JSON.stringify = function () { return '"forged"'; };
      JSON.parse = function () { return 'forged'; };
      Array.prototype.push = function () { throw new Error('push'); };
      Array.isArray = function () { return false; };
      Function.prototype.call = function () { throw new Error('call'); };
      Object.prototype.toJSON = function () { return 'forged'; };
      Object.prototype.get = function () { return 'forged'; };
      Object.defineProperty(Object.prototype, '$', { get: function () { return 'u'; }, configurable: true });
      Object.defineProperty(Array.prototype, '0', { set: function () { throw new Error('setter'); }, configurable: true });
      Map.prototype.set = function () { throw new Error('map'); };
      String.prototype.charCodeAt = function () { return 0; };
    `);
    const value = { a: [1, 'two', { b: new Map([[1, new Set([2])]]) }], c: -0 };
    const text = tampered.encode(value, DEFAULT_MAX_BYTES);
    expect(text).toBe(canonical(value));
    expect(canonical(tampered.decode(text))).toBe(text);
  });

  it('R7.5 a returned function or symbol is a marker that carries no data', () => {
    expect(canonical(() => 1)).toBe('{"$":"function"}');
    expect(canonical(Symbol('secret'))).toBe('{"$":"symbol"}');
    expect(canonical({ f() {}, s: Symbol('x') })).toBe('{"$":"obj","e":[["f",{"$":"function"}],["s",{"$":"symbol"}]]}');
  });

  it('R7.5 an output cycle is a back-reference, and two equal cyclic outputs have equal forms', () => {
    const make = (): unknown[] => {
      const node: Record<string, unknown> = { name: 'n' };
      node.self = node;
      const list: unknown[] = [node];
      list.push(list);
      return list;
    };
    expect(canonical(make())).toBe(canonical(make()));
    expect(canonical(make())).toContain('{"$":"cyc","d":');
    expect(deepEquivalent(make(), make())).toBe(true);
  });

  it('R8.6 a Promise is encoded as a plain object and is not awaited', () => {
    expect(canonical(Promise.resolve(1))).toBe('{"$":"obj","e":[]}');
  });

  it('R5.9 an oversized value is rejected while it is written', () => {
    expect(() => codec.encode('x'.repeat(2_000_000), 1024)).toThrow(/OUTPUT_LIMIT_EXCEEDED/);
    // A sparse array of a billion holes must fail fast, long before it is fully written.
    const started = Date.now();
    expect(() => codec.encode(new Array(1_000_000_000), 1024)).toThrow(/OUTPUT_LIMIT_EXCEEDED/);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(codec.encode('x'.repeat(1022), 1024)).toHaveLength(1024);
  });

  it('R5.9 a value nested deeper than 256 levels is rejected', () => {
    const nest = (levels: number): unknown => {
      let value: unknown = 0;
      for (let i = 0; i < levels; i++) value = [value];
      return value;
    };
    expect(() => codec.encode(nest(256), 1_000_000)).not.toThrow();
    expect(() => codec.encode(nest(257), 1_000_000)).toThrow(/OUTPUT_LIMIT_EXCEEDED/);
    expect(() => codec.encode(nest(10_000), 1_000_000)).toThrow(/OUTPUT_LIMIT_EXCEEDED/);
  });

  it('R7.7 the decoder rejects malformed text, unknown tags, output-only tags, and excessive depth', () => {
    const bad = ['', '{', '[1,2]', '{"$":"nope"}', '{"a":1}', '{"$":"function"}', '{"$":"symbol"}', '{"$":"cyc","d":1}', '{"$":"hole"}',
      '{"$":"big","v":"1e3"}', '{"$":"big","v":12}', '{"$":"arr","v":5}', '{"$":"obj","e":[["a"]]}', '{"$":"obj","e":[[1,2]]}',
      '{"$":"date","t":"x"}', '{"$":"re","s":"(","f":""}', '{"$":"ta","c":"Array","e":[]}', '{"$":"ta","c":"Uint8Array","e":["a"]}',
      '{"$":"ta","c":"BigInt64Array","e":[1]}', '{"$":"map","e":[[1]]}'];
    for (const text of bad) expect(() => codec.decode(text), text).toThrow(/UNSUPPORTED_VALUE/);
    const deep = '{"$":"arr","v":['.repeat(257) + '0' + ']}'.repeat(257);
    expect(() => codec.decode(deep)).toThrow(/UNSUPPORTED_VALUE/);
  });
});

describe('host input encoder', () => {
  const rejected: [string, unknown, RegExp][] = [
    ['a function', { a: [() => 1] }, /function at input\["a"\]\[0\]/],
    ['a symbol', [Symbol('s')], /symbol at input\[0\]/],
    ['a WeakMap', { w: new WeakMap() }, /WeakMap\) at input\["w"\]/],
    ['a Promise', Promise.resolve(1), /Promise\) at input/],
    ['a host-only object', { u: new URL('http://example.test') }, /URL\) at input\["u"\]/],
    ['a symbol-keyed function', { [Symbol('k')]: () => 1 }, /function under a symbol key at input/],
  ];
  it.each(rejected)('R7.3 rejects %s with the kind of value and its path', (_label, value, pattern) => {
    const result = encodeInput(value, DEFAULT_MAX_BYTES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(pattern);
  });

  it('R7.3 ignores a symbol key whose value is neither a function nor a symbol', () => {
    expect(encodeInput({ a: 1, [Symbol('k')]: 2 }, DEFAULT_MAX_BYTES)).toEqual({ ok: true, text: '{"$":"obj","e":[["a",1]]}' });
  });

  it('R7.4 rejects a cyclic input with the message "cyclic input"', () => {
    const node: Record<string, unknown> = {};
    node.self = node;
    expect(encodeInput(node, DEFAULT_MAX_BYTES)).toEqual({ ok: false, message: 'cyclic input' });
  });

  it('R7.4 writes a shared reference in full at every occurrence', () => {
    const shared = [1];
    expect(encodeInput([shared, shared], DEFAULT_MAX_BYTES)).toEqual({
      ok: true,
      text: '{"$":"arr","v":[{"$":"arr","v":[1]},{"$":"arr","v":[1]}]}',
    });
  });

  it('R7.6 enforces maxValueBytes and the depth of 256', () => {
    expect(encodeInput('x'.repeat(2000), 1024).ok).toBe(false);
    let deep: unknown = 0;
    for (let i = 0; i < 257; i++) deep = [deep];
    expect(encodeInput(deep, 1_000_000).ok).toBe(false);
  });

  it('R2.4 never throws when an input cannot be read', () => {
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error('boom'); } });
    expect(encodeInput(hostile, DEFAULT_MAX_BYTES)).toEqual({ ok: false, message: 'an input could not be read' });
  });
});
