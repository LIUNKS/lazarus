import 'server-only';

// The only door from the web app to the Sandbox_Runner (Requirement 1 criterion 3). No other file under `src/`
// imports `@lazarus/sandbox-runner`. Every run goes through `verifyLive`, so the Gate decides every run and
// releases its Lease on every path.
import {
  createLiveExecutionGate,
  verifyLive,
  type GateConfig,
  type LiveExecutionGate,
  type LiveRequest,
  type SandboxResult,
} from '@lazarus/sandbox-runner';

export type { GateConfig, LiveExecutionGate, LiveRequest, SandboxResult };

export interface SandboxPort {
  run(request: LiveRequest): Promise<SandboxResult>;
}

export function createSandboxPort(gate: LiveExecutionGate): SandboxPort {
  return { run: (request) => verifyLive(request, gate) };
}

export function createGate(config: Partial<GateConfig>): LiveExecutionGate {
  return createLiveExecutionGate(config);
}
