// Shared row, result, and response types of the Pipeline_API. Pure module: it holds types only, so pure
// modules can use them without importing the server-only store.
import type { ImpurityMarker } from '@lazarus/mcp-curse-scanner';
import type { CorpseStatus, SourceLanguage } from '@/lib/data/types';

export type { CorpseStatus, SourceLanguage };

export type ResultSource = 'precomputed' | 'stored' | 'cache' | 'generated';

export interface CorpseRow {
  id: string;
  userId: string | null;
  isSample: boolean;
  sourceLanguage: SourceLanguage;
  originalCode: string;
  codeHash: string;
  status: CorpseStatus;
}

export interface SeanceRow {
  id: string;
  corpseId: string;
  requirementsMd: string;
  designMd: string;
  /** jsonb as returned by the database. `seanceBody` narrows it to an InvariantsDocument. */
  invariantsJson: unknown;
  approvedAt: string | null;
}

export interface ReincarnationRow {
  id: string;
  corpseId: string;
  targetStack: string;
  modernCode: string;
  pbtTestCode: string;
  pbtPassed: boolean | null;
  totalRuns: number | null;
  executionTimeMs: number | null;
  createdAt: string;
}

/** A curse as stored and returned: the five values the Hex Scanner persists. */
export interface CurseRowOut {
  curseType: string;
  severity: string;
  lineNumber: number;
  description: string;
  exorcismStrategy: string;
}

/** A corpse that has the same `code_hash` as the requested one. Used to rank cache candidates. */
export interface HashMatch {
  corpseId: string;
  userId: string | null;
  isSample: boolean;
  createdAt: string;
}

export interface NewSeance {
  corpseId: string;
  requirementsMd: string;
  designMd: string;
  invariantsJson: InvariantsDocument;
  approvedAt: null;
}

export interface NewReincarnation {
  corpseId: string;
  targetStack: string;
  modernCode: string;
  pbtTestCode: string;
  pbtPassed: boolean | null;
  totalRuns: number | null;
  executionTimeMs: number | null;
}

export type InsertResult<T> = { kind: 'inserted'; row: T } | { kind: 'conflict' };

/** The only two status changes the pipeline performs. */
export interface StatusChange {
  to: 'IN_SEANCE' | 'RESURRECTED';
}
/**
 * `updated: false` means the guard matched no row (a newer request already changed the status).
 * The caller then reports the status it read at the start of the request.
 */
export type StatusUpdate = { updated: true; status: CorpseStatus } | { updated: false };

export type QuotaVerdict =
  | { allowed: true }
  | { allowed: false; deniedBy: 'user' | 'global'; retryAfterSeconds: number };

export interface EntryCandidate {
  name: string;
  params: string[];
  pureCandidate: boolean;
  impurityMarkers: ImpurityMarker[];
}

/** The value stored in `seance_specs.invariants_json`. */
export interface InvariantsDocument {
  entry_function: string;
  input: string;
  output: string;
  invariants: string[];
}

export type Verification = 'VERIFIED' | 'FAILED' | 'NOT_RUN';

export interface SeanceResponse {
  ok: true;
  source: ResultSource;
  seance: {
    id: string;
    requirementsMd: string;
    designMd: string;
    invariants: InvariantsDocument;
    approvedAt: string | null;
  };
  corpse: { id: string; status: CorpseStatus };
}

export interface ReincarnationResponse {
  ok: true;
  source: ResultSource;
  reincarnation: {
    id: string;
    targetStack: string;
    modernCode: string;
    pbtTestCode: string;
    pbtPassed: boolean | null;
    totalRuns: number | null;
    executionTimeMs: number | null;
    createdAt: string;
    verification: Verification;
    evidence: string | null;
  };
  corpse: { id: string; status: CorpseStatus };
}

export interface ScanResponse {
  ok: true;
  source: 'precomputed' | 'generated';
  lineCount: number;
  curses: CurseRowOut[];
}
