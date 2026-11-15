import { stringify } from 'fast-check';
import { deepEquivalent } from './deep-equivalent.js';

/** The result of one call to an Entry_Function (Requirement 6, criteria 1 and 2). */
export type Outcome =
  | { kind: 'returned'; value: unknown }
  | { kind: 'threw'; name: string };

export const MAX_OUTCOME_LENGTH = 500;

/** Shortens `text` to at most `max` characters, ending in `...` when something was cut. */
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

const mapForEach = Map.prototype.forEach;
const setForEach = Set.prototype.forEach;

function setOwn(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function chainLength(value: object): number {
  let length = 0;
  for (let node: object | null = value; node !== null; node = Object.getPrototypeOf(node)) length++;
  return length;
}

/**
 * `fc.stringify` prints a plain object from another realm as `[object Object]`, because it tests for
 * the host `Object.prototype`. Values returned by legacy or modern code come from a `node:vm` realm,
 * so plain objects, arrays, Maps, and Sets are rebuilt with host constructors first. Shared references
 * and cycles are kept. Other values (Date, RegExp, typed arrays, primitives) print correctly as they are.
 */
function toHostRealm(value: unknown, seen: Map<object, unknown>): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return seen.get(value);
  const tag = Object.prototype.toString.call(value);
  if (Array.isArray(value)) {
    const out: unknown[] = new Array<unknown>(value.length);
    seen.set(value, out);
    for (const key of Object.keys(value)) {
      setOwn(out, key, toHostRealm((value as unknown as Record<string, unknown>)[key], seen));
    }
    return out;
  }
  if (tag === '[object Map]') {
    const out = new Map<unknown, unknown>();
    seen.set(value, out);
    mapForEach.call(value, (item: unknown, key: unknown) => {
      out.set(toHostRealm(key, seen), toHostRealm(item, seen));
    });
    return out;
  }
  if (tag === '[object Set]') {
    const out = new Set<unknown>();
    seen.set(value, out);
    setForEach.call(value, (item: unknown) => {
      out.add(toHostRealm(item, seen));
    });
    return out;
  }
  if (tag === '[object Object]' && chainLength(value) <= 2) {
    const out: object = Object.getPrototypeOf(value) === null ? Object.create(null) : {};
    seen.set(value, out);
    for (const key of Object.keys(value)) {
      setOwn(out, key, toHostRealm((value as Record<string, unknown>)[key], seen));
    }
    return out;
  }
  return value;
}

/** `fc.stringify` that works across realms and never throws, so a hostile value cannot break rendering. */
export function safeStringify(value: unknown): string {
  try {
    return stringify(toHostRealm(value, new Map()));
  } catch {
    return '[value that cannot be printed]';
  }
}

/**
 * Two Outcomes are equivalent when both returned structurally equal values, or both threw an error
 * with the same `name`. A returned value never equals a thrown one (Requirement 6, criteria 3 to 5).
 */
export function equivalentOutcomes(a: Outcome, b: Outcome): boolean {
  if (a.kind === 'returned' && b.kind === 'returned') return deepEquivalent(a.value, b.value);
  if (a.kind === 'threw' && b.kind === 'threw') return a.name === b.name;
  return false;
}

/** Names the kind and the value or error name, at most 500 characters (Requirement 9, criterion 1). */
export function renderOutcome(outcome: Outcome): string {
  const text =
    outcome.kind === 'returned'
      ? `returned: ${safeStringify(outcome.value)}`
      : `threw: ${outcome.name}`;
  return truncate(text, MAX_OUTCOME_LENGTH);
}
