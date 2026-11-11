const tagOf = (value: unknown): string => Object.prototype.toString.call(value);
const hasOwn = (target: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(target, key);

const dateGetTime = Date.prototype.getTime;
const regExpSource = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source')?.get;
const regExpFlags = Object.getOwnPropertyDescriptor(RegExp.prototype, 'flags')?.get;
const mapForEach = Map.prototype.forEach;
const setForEach = Set.prototype.forEach;
const numberValueOf = Number.prototype.valueOf;
const stringValueOf = String.prototype.valueOf;
const booleanValueOf = Boolean.prototype.valueOf;
const bigintValueOf = BigInt.prototype.valueOf;

type Visited = WeakMap<object, WeakSet<object>>;

function isObjectLike(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function sameKeys(a: object, b: object): string[] | null {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return null;
  for (const key of keysA) {
    if (!hasOwn(b, key)) return null;
  }
  return keysA;
}

function entriesOf(map: Map<unknown, unknown>): Array<[unknown, unknown]> {
  const out: Array<[unknown, unknown]> = [];
  mapForEach.call(map, (value: unknown, key: unknown) => {
    out.push([key, value]);
  });
  return out;
}

function valuesOf(set: Set<unknown>): unknown[] {
  const out: unknown[] = [];
  setForEach.call(set, (value: unknown) => {
    out.push(value);
  });
  return out;
}

function compare(a: unknown, b: unknown, visited: Visited): boolean {
  if (typeof a !== typeof b) return false;
  if (!isObjectLike(a) || !isObjectLike(b)) {
    // Primitives use SameValue (NaN equals NaN, +0 differs from -0). Two functions or two symbols are
    // equivalent when the types match; function bodies are never compared (Requirement 6, criterion 6).
    if (typeof a === 'function' || typeof a === 'symbol') return true;
    return Object.is(a, b);
  }

  // A pair that is already being compared is assumed equal. Every check below is a conjunction, so the
  // first difference ends the whole comparison and the assumption can never produce a wrong `true`.
  let partners = visited.get(a);
  if (partners === undefined) {
    partners = new WeakSet();
    visited.set(a, partners);
  }
  if (partners.has(b)) return true;
  partners.add(b);

  const tag = tagOf(a);
  if (tag !== tagOf(b)) return false;

  switch (tag) {
    case '[object Date]':
      return Object.is(dateGetTime.call(a), dateGetTime.call(b));
    case '[object RegExp]':
      return (
        regExpSource?.call(a) === regExpSource?.call(b) &&
        regExpFlags?.call(a) === regExpFlags?.call(b)
      );
    case '[object Number]':
      return Object.is(numberValueOf.call(a), numberValueOf.call(b)) && sameOwnValues(a, b, visited);
    case '[object String]':
      return stringValueOf.call(a) === stringValueOf.call(b) && sameOwnValues(a, b, visited);
    case '[object Boolean]':
      return booleanValueOf.call(a) === booleanValueOf.call(b) && sameOwnValues(a, b, visited);
    case '[object BigInt]':
      return bigintValueOf.call(a) === bigintValueOf.call(b) && sameOwnValues(a, b, visited);
    case '[object Map]': {
      const left = entriesOf(a as Map<unknown, unknown>);
      const right = entriesOf(b as Map<unknown, unknown>);
      if (left.length !== right.length) return false;
      return left.every(
        ([key, value], index) =>
          compare(key, right[index][0], visited) && compare(value, right[index][1], visited),
      );
    }
    case '[object Set]': {
      const left = valuesOf(a as Set<unknown>);
      const right = valuesOf(b as Set<unknown>);
      if (left.length !== right.length) return false;
      return left.every((value, index) => compare(value, right[index], visited));
    }
    case '[object Error]':
      return (
        compare((a as { name?: unknown }).name, (b as { name?: unknown }).name, visited) &&
        compare((a as { message?: unknown }).message, (b as { message?: unknown }).message, visited)
      );
    default:
      break;
  }

  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b) && tag !== '[object DataView]') {
    const left = a as unknown as ArrayLike<unknown>;
    const right = b as unknown as ArrayLike<unknown>;
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index++) {
      if (!Object.is(left[index], right[index])) return false;
    }
    return true;
  }

  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && a.length !== (b as unknown[]).length) return false;
  return sameOwnValues(a, b, visited);
}

/** Plain objects, arrays (holes included), and any other object: same own enumerable keys, equal values. */
function sameOwnValues(a: object, b: object, visited: Visited): boolean {
  const keys = sameKeys(a, b);
  if (keys === null) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return keys.every((key) => compare(left[key], right[key], visited));
}

/**
 * Structural equivalence of two returned values, independent of the realm that created them
 * (Requirement 6, criteria 3 and 6). It never looks at prototypes: it uses `Object.prototype.toString`
 * tags, `Array.isArray`, and the intrinsic methods captured when this module was loaded.
 */
export function deepEquivalent(a: unknown, b: unknown): boolean {
  return compare(a, b, new WeakMap());
}
