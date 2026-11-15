import 'server-only';

// The dependency container of the route handlers. Production wires the real collaborators here. Tests pass
// fakes (a memory store, a scripted gateway, a fixed clock, a seeded random source) through the same interface.
import { getCurrentMember, type Member } from '@/lib/auth/member';
import { requestOrigin } from '@/lib/security/request-origin';
import { createClient } from '@/lib/supabase/server';
import { readLlmConfig, type LlmConfig, type LlmConfigResult } from '@/lib/llm/config';
import { createGateway, type LlmGateway } from '@/lib/llm/generate';
import { LIMITS, type PipelineLimits } from './limits';
import { writeLogLine, type LogLine } from './log';
import { createSupabaseStore, type PipelineStore } from './store';

export interface Session {
  /** The verified Member, or null for a Visitor. */
  member: Member | null;
  store: PipelineStore;
}

export interface PipelineDeps {
  /** Creates the Server_Client of the request, resolves the caller from verified claims, and wraps the client in a store. */
  session(): Promise<Session>;
  readLlmConfig(): LlmConfigResult;
  createGateway(config: LlmConfig): LlmGateway;
  now(): number;
  randomBytes(length: number): Uint8Array;
  log(line: LogLine): void;
  limits: PipelineLimits;
  appOrigin(request: Request): string | null;
}

export function productionDeps(): PipelineDeps {
  return {
    async session() {
      // One client per request: the identity check and every query use the same Server_Client.
      const client = await createClient();
      const member = await getCurrentMember(client);
      return { member, store: createSupabaseStore(client) };
    },
    readLlmConfig: () => readLlmConfig(),
    createGateway,
    now: () => Date.now(),
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    log: writeLogLine,
    limits: LIMITS,
    appOrigin: (request) => requestOrigin(request.headers),
  };
}
