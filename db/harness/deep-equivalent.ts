// Realm-agnostic structural comparison used by the PBT runner.
// Values created inside different node:vm contexts have different built-in prototypes,
// so prototypes are never compared. Rules follow `database-and-exorcism.md`, section 3.

export type Outcome =
  | { kind: 'returned'; value: unknown }
  | { kind: 'threw'; name: string };

function tagOf(value: unknown): string {
  return Object.prototype.toString.call(value);
}

function ownKeys(value: object): string[] {
  return Object.keys(value).sort();
}

export function deepEquivalent(a: unknown, b: unknown): boolean {
  if (typeof a !== typeof b) return false;
  if (typeof a === 'function' || typeof a === 'symbol') return true;
  if (typeof a !== 'object' || typeof b !== 'object') return Object.is(a, b);
  if (a === null || b === null) return a === b;

  const tag = tagOf(a);
  if (tag !== tagOf(b)) return false;

  if (Array.isArray(a)) {
    const other = b as unknown[];
    if (a.length !== other.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (Object.hasOwn(a, i) !== Object.hasOwn(other, i)) return false;
      if (!deepEquivalent(a[i], other[i])) return false;
    }
    return true;
  }
  if (tag === '[object Date]') {
    return Object.is(Date.prototype.getTime.call(a), Date.prototype.getTime.call(b));
  }
  if (tag === '[object RegExp]') {
    const left = a as RegExp;
    const right = b as RegExp;
    return left.source === right.source && left.flags === right.flags;
  }
  if (tag === '[object Map]') {
    const left = [...(a as Map<unknown, unknown>)];
    const right = [...(b as Map<unknown, unknown>)];
    return deepEquivalent(left, right);
  }
  if (tag === '[object Set]') {
    return deepEquivalent([...(a as Set<unknown>)], [...(b as Set<unknown>)]);
  }
  if (tag === '[object Error]') {
    const left = a as Error;
    const right = b as Error;
    return left.name === right.name && left.message === right.message;
  }

  const leftKeys = ownKeys(a);
  const rightKeys = ownKeys(b);
  if (leftKeys.length !== rightKeys.length) return false;
  for (let i = 0; i < leftKeys.length; i += 1) {
    const key = leftKeys[i] as string;
    if (key !== rightKeys[i]) return false;
    if (!deepEquivalent((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
}

export function equivalentOutcomes(a: Outcome, b: Outcome): boolean {
  if (a.kind === 'threw' && b.kind === 'threw') return a.name === b.name;
  if (a.kind === 'returned' && b.kind === 'returned') return deepEquivalent(a.value, b.value);
  return false;
}

export function renderOutcome(outcome: Outcome): string {
  const text =
    outcome.kind === 'threw'
      ? `threw ${outcome.name}`
      : `returned ${safeStringify(outcome.value)}`;
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

function safeStringify(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
}
