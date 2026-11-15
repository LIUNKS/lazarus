// Additive subpath export (`@lazarus/pbt-verifier/shared`) for `@lazarus/sandbox-runner`. It exposes
// pieces that already exist, so both packages apply the same compile step, comparison rules, and
// evidence wording. Nothing here changes the behavior of the public API in `index.ts`.
export { deepEquivalent } from './equivalence/deep-equivalent.js';
export { formatEvidence, sanitizeResult } from './evidence.js';
export { compileModernCode, type CompileResult } from './sandbox/modern-loader.js';
export type {
  Counterexample,
  ErrorCode,
  ErrorResult,
  FailedResult,
  PassedResult,
  VerificationResult,
} from './types.js';
