import { runInContext, type Context } from 'node:vm';

/** Thrown by the host helper when an input cannot be deep-copied (Requirement 6, criterion 8). */
export class UncloneableInputError extends Error {
  constructor(detail: string) {
    super(`Inputs must be structured-cloneable: ${detail}`);
    this.name = 'UncloneableInputError';
  }
}

/**
 * Source of the context-side deep cloner. It is evaluated once per sandbox, before any user code runs,
 * and its value is the `cloneValue` function. It is never bound to a global name inside the context.
 *
 * The cloner builds every copy with the intrinsics of the context it runs in, so `copy instanceof Array`
 * is true for user code. It captures the intrinsics it needs at creation time, so user code that later
 * modifies built-ins (for example `Array.prototype`) cannot change how copies are made. Properties are
 * created with `defineProperty`, so a key such as `__proto__` becomes an own data property.
 *
 * Supported: undefined, null, booleans, numbers (NaN, -0, infinities), bigints, strings, plain objects,
 * arrays (holes preserved), Date, RegExp, Map, Set, and typed arrays. Shared references and cycles are
 * reproduced. Anything else (functions, symbols, class instances, boxed primitives, ArrayBuffer,
 * DataView) throws a TypeError, which the host helper converts to an UncloneableInputError.
 */
const CLONER_SOURCE = `(function () {
  'use strict';
  var call = Function.prototype.call;
  function uncurry(fn) { return call.bind(fn); }
  var ObjectCtor = Object, ArrayCtor = Array, MapCtor = Map, SetCtor = Set;
  var DateCtor = Date, RegExpCtor = RegExp, TypeErrorCtor = TypeError;
  var objectKeys = Object.keys, getPrototypeOf = Object.getPrototypeOf;
  var defineProperty = Object.defineProperty, isArray = Array.isArray, isView = ArrayBuffer.isView;
  var tagOf = uncurry(Object.prototype.toString);
  var mapForEach = uncurry(Map.prototype.forEach), mapSet = uncurry(Map.prototype.set);
  var mapGet = uncurry(Map.prototype.get);
  var setForEach = uncurry(Set.prototype.forEach), setAdd = uncurry(Set.prototype.add);
  var dateGetTime = uncurry(Date.prototype.getTime);
  var regExpSource = uncurry(ObjectCtor.getOwnPropertyDescriptor(RegExp.prototype, 'source').get);
  var regExpFlags = uncurry(ObjectCtor.getOwnPropertyDescriptor(RegExp.prototype, 'flags').get);
  var typedArrays = {
    '[object Int8Array]': Int8Array, '[object Uint8Array]': Uint8Array,
    '[object Uint8ClampedArray]': Uint8ClampedArray, '[object Int16Array]': Int16Array,
    '[object Uint16Array]': Uint16Array, '[object Int32Array]': Int32Array,
    '[object Uint32Array]': Uint32Array, '[object Float32Array]': Float32Array,
    '[object Float64Array]': Float64Array, '[object BigInt64Array]': BigInt64Array,
    '[object BigUint64Array]': BigUint64Array
  };
  if (typeof Float16Array === 'function') typedArrays['[object Float16Array]'] = Float16Array;

  function define(target, key, value) {
    defineProperty(target, key, { value: value, writable: true, enumerable: true, configurable: true });
  }

  // Number of objects on the prototype chain, starting with v itself. It does not depend on the realm:
  // a plain object has 1 (null prototype) or 2, Array/Date/RegExp/Map/Set have 3 (instance, own
  // prototype, Object.prototype), and a typed array has 4 (one more for %TypedArray%.prototype).
  // A subclass instance, such as a Buffer or a class extending Map, has a longer chain and is rejected.
  function chainLength(v) {
    var n = 0;
    for (var p = v; p !== null; p = getPrototypeOf(p)) n++;
    return n;
  }
  function expectChain(v, expected, tag) {
    if (chainLength(v) !== expected) {
      throw new TypeErrorCtor('an object of kind ' + tag + ' with a custom prototype cannot be copied');
    }
  }

  function cloneValue(root) {
    var seen = new MapCtor();
    function clone(v) {
      var type = typeof v;
      if (v === null || type === 'undefined' || type === 'boolean' || type === 'number' ||
          type === 'string' || type === 'bigint') return v;
      if (type !== 'object') throw new TypeErrorCtor('a value of type ' + type + ' cannot be copied');
      var known = mapGet(seen, v);
      if (known !== undefined) return known;
      var tag = tagOf(v), out, i, keys;
      if (isArray(v)) {
        expectChain(v, 3, 'Array');
        out = new ArrayCtor(v.length);
        mapSet(seen, v, out);
        keys = objectKeys(v);
        for (i = 0; i < keys.length; i++) define(out, keys[i], clone(v[keys[i]]));
        return out;
      }
      if (tag === '[object Date]') {
        expectChain(v, 3, 'Date');
        out = new DateCtor(dateGetTime(v));
        mapSet(seen, v, out);
        return out;
      }
      if (tag === '[object RegExp]') {
        expectChain(v, 3, 'RegExp');
        out = new RegExpCtor(regExpSource(v), regExpFlags(v));
        out.lastIndex = v.lastIndex;
        mapSet(seen, v, out);
        return out;
      }
      if (tag === '[object Map]') {
        expectChain(v, 3, 'Map');
        out = new MapCtor();
        mapSet(seen, v, out);
        mapForEach(v, function (value, key) { mapSet(out, clone(key), clone(value)); });
        return out;
      }
      if (tag === '[object Set]') {
        expectChain(v, 3, 'Set');
        out = new SetCtor();
        mapSet(seen, v, out);
        setForEach(v, function (value) { setAdd(out, clone(value)); });
        return out;
      }
      if (isView(v) && typedArrays[tag] !== undefined) {
        expectChain(v, 4, 'typed array');
        out = new typedArrays[tag](v);
        mapSet(seen, v, out);
        return out;
      }
      if (tag === '[object Object]' && chainLength(v) <= 2) {
        out = {};
        mapSet(seen, v, out);
        keys = objectKeys(v);
        for (i = 0; i < keys.length; i++) define(out, keys[i], clone(v[keys[i]]));
        return out;
      }
      throw new TypeErrorCtor('an object of kind ' + tag + ' cannot be copied');
    }
    return clone(root);
  }
  return cloneValue;
})()`;

function messageOf(cause: unknown): string {
  try {
    if (typeof cause === 'object' && cause !== null) {
      const { message } = cause as { message?: unknown };
      if (typeof message === 'string') return message;
    }
  } catch {
    // A hostile getter on the error object: fall through to the generic text.
  }
  return 'the value contains an unsupported type';
}

/**
 * Evaluates the cloner inside `context` and returns a host function that deep-copies a value into that
 * context. Call it before any user code runs in the context.
 */
export function createCloner(context: Context): (value: unknown) => unknown {
  const cloneValue = runInContext(CLONER_SOURCE, context, { displayErrors: false }) as (
    value: unknown,
  ) => unknown;
  return (value: unknown): unknown => {
    try {
      return cloneValue(value);
    } catch (cause) {
      throw new UncloneableInputError(messageOf(cause));
    }
  };
}
