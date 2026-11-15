// Shared setup for the route tests: requests, corpses, valid model outputs, and a PipelineDeps built from the doubles.
// Test-only: no production module imports this file.
import type { PipelineDeps } from '@/lib/pipeline/deps';
import type { LlmConfigResult } from '@/lib/llm/config';
import type { ProviderOutcome } from '@/lib/llm/generate';
import { LIMITS, type PipelineLimits } from '@/lib/pipeline/limits';
import type { LogLine } from '@/lib/pipeline/log';
import type { CurseRowOut, ReincarnationRow, SeanceRow } from '@/lib/pipeline/types';
import { earsLines, lengthen } from './arbitraries';
import { MemoryStore, type MemoryCorpse, type QuotaScript } from './memory-store';
import { MockGateway } from './mock-gateway';

export const APP_ORIGIN = 'https://lazarus.example';
export const MEMBER_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_ID = '22222222-2222-4222-8222-222222222222';
export const OWNED_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const SAMPLE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const FOREIGN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const MISSING_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const SIBLING_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

export const LEGACY_CODE = 'function calc(a, b) {\n  return a + b;\n}\n';
export const API_KEY_SENTINEL = 'sentinel-api-key-91d3';

export type RouteName = 'scan' | 'seance' | 'reincarnate';
export const PATH: Record<RouteName, string> = { scan: '/api/scan', seance: '/api/seance', reincarnate: '/api/reincarnate' };

/** A valid request. `corpseId` and the other fields can be overridden to build a rejected one. */
export function requestFor(route: RouteName, body: unknown, overrides: { origin?: string | null; contentType?: string | null; method?: string; raw?: string } = {}): Request {
  const headers = new Headers();
  const origin = overrides.origin === undefined ? APP_ORIGIN : overrides.origin;
  const contentType = overrides.contentType === undefined ? 'application/json' : overrides.contentType;
  if (origin !== null) headers.set('origin', origin);
  if (contentType !== null) headers.set('content-type', contentType);
  const method = overrides.method ?? 'POST';
  return new Request(`${APP_ORIGIN}${PATH[route]}`, {
    method,
    headers,
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: overrides.raw ?? JSON.stringify(body) }),
  });
}
export const bodyFor = (corpseId: string) => ({ corpseId });

export function makeCorpse(overrides: Partial<MemoryCorpse> = {}): MemoryCorpse {
  return {
    id: OWNED_ID,
    userId: MEMBER_ID,
    isSample: false,
    sourceLanguage: 'es5-jquery',
    originalCode: LEGACY_CODE,
    codeHash: 'hash-owned',
    status: 'INFECTED',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}
export const sampleCorpse = (overrides: Partial<MemoryCorpse> = {}) =>
  makeCorpse({ id: SAMPLE_ID, userId: null, isSample: true, codeHash: 'hash-sample', status: 'RESURRECTED', ...overrides });
export const foreignCorpse = (overrides: Partial<MemoryCorpse> = {}) => makeCorpse({ id: FOREIGN_ID, userId: OTHER_ID, codeHash: 'hash-foreign', ...overrides });

export function validSeanceOutput(entry = 'calc') {
  return {
    requirementsMd: lengthen(`# Requirements\n${earsLines(4, ['sum', 'value']).join('\n')}`, 220),
    designMd: lengthen(`The function ${entry} adds two numbers and returns their sum.`, 120),
    invariants: { entry_function: entry, input: 'two numbers', output: 'their sum', invariants: ['returns a number', 'is deterministic', 'is commutative'] },
  };
}
export function validReincarnationOutput() {
  return {
    modernCode: 'export function calc(a: number, b: number): number {\n  return a + b;\n}\n',
    pbtTestCode: 'const n = fc.integer();\nreturn fc.property(fc.tuple(n, n), (input) => {\n  assertEquivalent(input);\n});\n',
  };
}

export function seanceRow(corpseId: string, overrides: Partial<SeanceRow> = {}): SeanceRow {
  const output = validSeanceOutput();
  return { id: `seance-of-${corpseId.slice(0, 4)}`, corpseId, requirementsMd: output.requirementsMd, designMd: output.designMd, invariantsJson: output.invariants, approvedAt: null, ...overrides };
}
export function reincarnationRow(corpseId: string, overrides: Partial<ReincarnationRow> = {}): ReincarnationRow {
  const output = validReincarnationOutput();
  return {
    id: `reincarnation-of-${corpseId.slice(0, 4)}`,
    corpseId,
    targetStack: 'TypeScript (strict, ES2022)',
    modernCode: output.modernCode,
    pbtTestCode: output.pbtTestCode,
    pbtPassed: null,
    totalRuns: null,
    executionTimeMs: null,
    createdAt: '2026-06-02T00:00:00.000Z',
    ...overrides,
  };
}

const VALID_CONFIG: LlmConfigResult = { ok: true, config: { groqApiKey: API_KEY_SENTINEL, model: 'openai/gpt-oss-120b', fallback: null } };
export const INVALID_CONFIG: LlmConfigResult = { ok: false, problems: [{ variable: 'GROQ_API_KEY', reason: 'missing' }] };

export interface HarnessOptions {
  /** null is a Visitor. */
  memberId?: string | null;
  corpses?: MemoryCorpse[];
  seances?: SeanceRow[];
  reincarnations?: ReincarnationRow[];
  curses?: Record<string, CurseRowOut[]>;
  quota?: QuotaScript[];
  /** The scripted provider outcomes. */
  script?: Array<ProviderOutcome<unknown>>;
  fallbackAvailable?: boolean;
  config?: LlmConfigResult;
  /** When set, `deps.session()` throws. */
  sessionThrows?: boolean;
  /** Bytes for each delimiter attempt. Default: a different value every call. */
  randomBytes?: (call: number, length: number) => Uint8Array;
  now?: () => number;
  limits?: Partial<PipelineLimits>;
}

export function buildHarness(options: HarnessOptions = {}) {
  const timeline: string[] = [];
  const logs: LogLine[] = [];
  const memberId = options.memberId === undefined ? MEMBER_ID : options.memberId;
  const store = new MemoryStore({
    memberId,
    corpses: options.corpses ?? [makeCorpse(), sampleCorpse(), foreignCorpse()],
    seances: options.seances ?? [],
    reincarnations: options.reincarnations ?? [],
    curses: options.curses ?? {},
    quota: options.quota ?? [{ allowed: true }],
    timeline,
  });
  const gateway = new MockGateway(options.script ?? [], { fallbackAvailable: options.fallbackAvailable ?? false, timeline });
  const counters = { configReads: 0, gatewaysCreated: 0, randomCalls: 0, sessions: 0 };
  const config = options.config ?? VALID_CONFIG;
  const pickBytes = options.randomBytes ?? ((call, length) => new Uint8Array(length).fill((call % 250) + 1));

  const deps: PipelineDeps = {
    async session() {
      counters.sessions += 1;
      timeline.push('session');
      if (options.sessionThrows) throw new Error('sentinel-session-error-5a0e');
      return { member: memberId === null ? null : { id: memberId, email: 'member@example.test' }, store };
    },
    readLlmConfig() {
      counters.configReads += 1;
      timeline.push('config');
      return config;
    },
    createGateway() {
      counters.gatewaysCreated += 1;
      return gateway;
    },
    now: options.now ?? (() => 1_000_000),
    randomBytes(length) {
      counters.randomCalls += 1;
      return pickBytes(counters.randomCalls, length);
    },
    log: (line) => logs.push(line),
    limits: { ...LIMITS, ...options.limits },
    appOrigin: () => APP_ORIGIN,
  };
  return { deps, store, gateway, logs, timeline, counters };
}

export type Harness = ReturnType<typeof buildHarness>;
