// Public API of @lazarus/sandbox-runner. Nothing else is exported.
export { runSandboxedCases } from './cases-mode.js';
export { createLiveExecutionGate, type AcquireResult, type Lease, type LiveExecutionGate } from './gate/gate.js';
export { verifyLive } from './live.js';
export { runSandboxedVerification } from './property-mode.js';
export type {
  Caller,
  CaseEntry,
  CaseOutcome,
  CasesResult,
  Counterexample,
  DenialReason,
  Executor,
  GateConfig,
  LiveRequest,
  Origin,
  SandboxCasesOptions,
  SandboxErrorCode,
  SandboxErrorResult,
  SandboxFailedResult,
  SandboxLimits,
  SandboxPassedResult,
  SandboxResult,
  SandboxVerifyOptions,
  SharedErrorCode,
} from './types.js';
