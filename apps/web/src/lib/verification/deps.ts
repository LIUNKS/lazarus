import 'server-only';

// The dependency container of POST /api/verify. Production wires the real collaborators here. Tests pass an
// in-memory store, a scripted sandbox, a fixed clock, and a fixed seed through the same interface.
import { getCurrentMember, type Member } from '@/lib/auth/member';
import { writeLogLine, type LogLine } from '@/lib/pipeline/log';
import { requestOrigin } from '@/lib/security/request-origin';
import { createClient } from '@/lib/supabase/server';
import { effectiveExecution, effectiveSampleExecution, type ExecutionDecision } from './execution';
import { getVerificationGate } from './gate';
import type { VerifyErrorCode } from './errors';
import { createSandboxPort, type SandboxPort } from './sandbox';
import { createSupabaseVerificationStore, type VerificationStore } from './store';

/**
 * The two log lines of this route (Requirement 9 criteria 5 to 7). No field can hold source code, a test, a
 * counterexample, a Sandbox_Runner message, an email address, or a configuration value.
 */
export type VerifyLogLine =
  | {
      event: 'verification_error';
      route: 'verify';
      code: VerifyErrorCode;
      /** The corpse id once the request body was accepted, and null before. */
      corpseId: string | null;
      /** Milliseconds from the start of the handler to the response, a non-negative integer. */
      elapsedMs: number;
      /** A short constant: a Sandbox_Runner code, a denial reason, a SQLSTATE, or a fixed word. */
      detail: string;
    }
  | {
      event: 'verification_run';
      route: 'verify';
      corpseId: string;
      userId: string;
      status: 'PASSED' | 'FAILED' | 'ERROR' | 'unknown';
      code: string | null;
      totalRuns: number | null;
      executionTimeMs: number | null;
      /** The seed chosen by the server, so a maintainer can reproduce the run. Never stored or returned. */
      seed: number;
    };

export interface VerifySession {
  /** The verified Member, or null for a Visitor. */
  member: Member | null;
  store: VerificationStore;
}

export interface VerifyDeps {
  /** Creates the Server_Client of the request, resolves the caller from verified claims, and wraps the client. */
  session(): Promise<VerifySession>;
  sandbox: SandboxPort;
  /** The decision for an Owned_Corpse: the reviewed flag and the kill switch. */
  execution(): ExecutionDecision;
  /** The decision for a live run of a Sample_Corpse by a Member: the kill switch only. */
  sampleExecution(): ExecutionDecision;
  /** A 32-bit signed integer. */
  randomSeed(): number;
  now(): number;
  log(line: VerifyLogLine): void;
  appOrigin(request: Request): string | null;
}

export function verificationDeps(): VerifyDeps {
  return {
    async session() {
      // One client per request: the identity check and every query use the same Server_Client.
      const client = await createClient();
      const member = await getCurrentMember(client);
      return { member, store: createSupabaseVerificationStore(client) };
    },
    sandbox: createSandboxPort(getVerificationGate()),
    execution: effectiveExecution,
    sampleExecution: effectiveSampleExecution,
    randomSeed: () => crypto.getRandomValues(new Int32Array(1))[0] ?? 0,
    now: () => Date.now(),
    // The single log writer of 05 writes one JSON line. The two line types of this route carry only safe fields.
    log: (line) => writeLogLine(line as unknown as LogLine),
    appOrigin: (request) => requestOrigin(request.headers),
  };
}
