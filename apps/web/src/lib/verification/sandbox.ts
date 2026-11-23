import 'server-only';

// The only door from the web app to the Sandbox_Runner (Requirement 1 criterion 3). No other file under `src/`
// imports `@lazarus/sandbox-runner`. Every run goes through `verifyLive`, so the Gate decides every run and
// releases its Lease on every path.
//
// The package is loaded at run time and not bundled. It starts Workers from files in its own dist/worker/
// directory, found through import.meta.url, and a bundler cannot resolve that directory (Turbopack fails the build
// with "Can't resolve '../worker/'"). `serverExternalPackages` does not apply to it, because pnpm links workspace
// packages from outside node_modules. The magic comment keeps the import as it is, so Node.js resolves the package
// from node_modules when the route first runs.
import type { GateConfig, LiveExecutionGate, LiveRequest, SandboxResult } from '@lazarus/sandbox-runner';

export type { GateConfig, LiveExecutionGate, LiveRequest, SandboxResult };

type Runner = typeof import('@lazarus/sandbox-runner');

let runner: Promise<Runner> | null = null;

function loadRunner(): Promise<Runner> {
  runner ??= import(/* webpackIgnore: true */ '@lazarus/sandbox-runner');
  return runner;
}

export interface SandboxPort {
  run(request: LiveRequest): Promise<SandboxResult>;
}

/** The result for a Sandbox_Runner that cannot be loaded. It never falls back to in-process execution. */
const UNAVAILABLE: SandboxResult = {
  status: 'ERROR',
  executor: 'none',
  code: 'SANDBOX_UNAVAILABLE',
  message: 'The sandbox runner could not be loaded.',
  executionTimeMs: 1,
};

const SAFE_TOKEN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

function safeToken(value: unknown): string | null {
  return typeof value === 'string' && SAFE_TOKEN.test(value) ? value : null;
}

/**
 * One log line for a Sandbox_Runner that could not be loaded, with the error name and the Node.js error code only
 * (for example `ERR_MODULE_NOT_FOUND`). Never the message or the stack, which can hold file paths.
 */
export function sandboxLoadFailureLine(error: unknown): { event: 'sandbox_load_failed'; route: 'verify'; errorName: string | null; errorCode: string | null } {
  let name: unknown;
  let code: unknown;
  try {
    if (typeof error === 'object' && error !== null) ({ name, code } = error as Record<string, unknown>);
  } catch {
    // An unreadable error is logged with null fields.
  }
  return { event: 'sandbox_load_failed', route: 'verify', errorName: safeToken(name), errorCode: safeToken(code) };
}

export function createSandboxPort(gate: Promise<LiveExecutionGate>): SandboxPort {
  return {
    async run(request) {
      let loaded: [Runner, LiveExecutionGate];
      try {
        loaded = await Promise.all([loadRunner(), gate]);
      } catch (error) {
        runner = null;
        try {
          console.error(JSON.stringify(sandboxLoadFailureLine(error)));
        } catch {
          // A failing logger must not change the result.
        }
        return UNAVAILABLE;
      }
      const [{ verifyLive }, live] = loaded;
      return verifyLive(request, live);
    },
  };
}

export async function createGate(config: Partial<GateConfig>): Promise<LiveExecutionGate> {
  const { createLiveExecutionGate } = await loadRunner();
  return createLiveExecutionGate(config);
}
