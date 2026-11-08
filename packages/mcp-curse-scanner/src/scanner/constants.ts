import type { CurseType, ImpurityMarker, Severity, SourceLanguage } from './types.js';

export const SOURCE_LANGUAGES: readonly SourceLanguage[] = ['es3', 'es5-jquery', 'legacy-node'];

export const CURSE_TYPE_ORDER: readonly CurseType[] = [
  'GLOBAL_POLLUTION',
  'VAR_HOISTING',
  'IMPLICIT_COERCION',
  'CALLBACK_HELL',
  'EVAL_INJECTION',
  'PROTOTYPE_POLLUTION',
];

export interface CurseInfo {
  severity: Severity;
  description: string;
  exorcismStrategy: string;
}

// The only source of severity, description, and exorcismStrategy.
export const CURSE_TABLE: Readonly<Record<CurseType, CurseInfo>> = {
  GLOBAL_POLLUTION: {
    severity: 'BLOOD_CURSE',
    description:
      'Assignment to a name that is never declared, or to a property of window or global, which creates or changes mutable global state shared by every caller.',
    exorcismStrategy:
      'Declare the value as a local binding or pass it as a function argument, and return results instead of writing to global state.',
  },
  VAR_HOISTING: {
    severity: 'HEX',
    description:
      'A var declaration is function scoped and hoisted to the top of its function, so the name is visible before its line and outside its block.',
    exorcismStrategy:
      'Replace var with const, or with let when the binding is reassigned, and declare it in the narrowest block that uses it.',
  },
  IMPLICIT_COERCION: {
    severity: 'HEX',
    description:
      'The loose equality operators == and != convert operand types before comparing, so unrelated values can compare as equal.',
    exorcismStrategy:
      'Use strict equality (=== and !==) and convert values explicitly where a conversion is intended.',
  },
  CALLBACK_HELL: {
    severity: 'BLOOD_CURSE',
    description:
      'A callback is nested inside at least two other callbacks, which builds a deep pyramid of control flow that is hard to read, test, and handle errors in.',
    exorcismStrategy:
      'Extract each callback into a named function, or convert the call chain to promises and async functions with flat control flow.',
  },
  EVAL_INJECTION: {
    severity: 'FATAL',
    description:
      'Dynamic code evaluation through eval or the Function constructor runs text as code, which allows code injection and blocks static analysis.',
    exorcismStrategy:
      'Remove dynamic evaluation: replace it with a direct function call, a lookup table, or JSON.parse for data.',
  },
  PROTOTYPE_POLLUTION: {
    severity: 'FATAL',
    description:
      'A write through __proto__ or through a computed property key can change the prototype chain, so attacker-controlled keys may alter every object.',
    exorcismStrategy:
      'Reject the keys __proto__, constructor, and prototype, or store the data in a Map or in an object created with Object.create(null).',
  },
};

export const IMPURITY_MARKER_ORDER: readonly ImpurityMarker[] = [
  'GLOBAL_WRITE',
  'OUTER_SCOPE_WRITE',
  'NONDETERMINISTIC_API',
  'TIMER_API',
  'ENVIRONMENT_API',
  'DYNAMIC_CODE',
];

const ENVIRONMENT_NAMES = [
  'window',
  'document',
  'global',
  '$',
  'jQuery',
  'XMLHttpRequest',
  'navigator',
  'localStorage',
  'sessionStorage',
  'require',
  'process',
  'console',
  'module',
];

// Identifiers whose unresolved references mark a function. `Math` is handled separately
// because only `Math.random` counts.
export const WATCHED_NAMES: ReadonlyMap<string, ImpurityMarker> = new Map<string, ImpurityMarker>([
  ['Date', 'NONDETERMINISTIC_API'],
  ['setTimeout', 'TIMER_API'],
  ['setInterval', 'TIMER_API'],
  ['setImmediate', 'TIMER_API'],
  ...ENVIRONMENT_NAMES.map((name): [string, ImpurityMarker] => [name, 'ENVIRONMENT_API']),
]);

export const MESSAGES = {
  invalidInput: 'source must be a string and sourceLanguage must be es3, es5-jquery, or legacy-node.',
  inputTooLarge: 'The source exceeds the size limit of 1048576 bytes.',
  parserLimit: 'The source exceeds the nesting limit of the parser.',
  treeLimit: 'The source exceeds the node count or nesting depth limit.',
  internalFailure: 'Internal scan failure',
  timeout: 'The scan exceeded its time budget of 5000 ms.',
} as const;
