// Response shapes, verification and evidence text, and status transitions (Requirements 5, 9, 11, 12, 14, and 19).
// Pure module. No function here returns the status FAILED: that status belongs to POST /api/verify.
import { StoreError } from './errors';
import type {
  CorpseStatus,
  CurseRowOut,
  InvariantsDocument,
  ReincarnationResponse,
  ReincarnationRow,
  ResultSource,
  ScanResponse,
  SeanceResponse,
  SeanceRow,
  Verification,
} from './types';

export function verificationOf(pbtPassed: boolean | null): Verification {
  if (pbtPassed === true) return 'VERIFIED';
  if (pbtPassed === false) return 'FAILED';
  return 'NOT_RUN';
}

/** 1000 becomes "1,000". Written by hand so that the result never depends on the locale of the server. */
export function formatThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * The only string of the pipeline that states a verification outcome. It exists only when a run passed
 * and its run count is known. Otherwise there is no evidence text.
 */
export function evidenceOf(row: Pick<ReincarnationRow, 'pbtPassed' | 'totalRuns'>): string | null {
  const runs = row.totalRuns;
  if (row.pbtPassed !== true || runs === null || !Number.isSafeInteger(runs) || runs < 0) return null;
  return `Verified behavioral equivalence across ${formatThousands(runs)} generated inputs.`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Narrows the stored jsonb to the four-key Invariants_Document, or throws a StoreError. */
/** The `entry_function` of a stored invariants document, or null when it is missing or not a non-empty string. */
export function entryFunctionOf(invariantsJson: unknown): string | null {
  if (typeof invariantsJson !== 'object' || invariantsJson === null || Array.isArray(invariantsJson)) return null;
  const name = (invariantsJson as Record<string, unknown>)['entry_function'];
  return typeof name === 'string' && name !== '' ? name : null;
}

export function parseInvariantsDocument(value: unknown): InvariantsDocument {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new StoreError('invariants-shape');
  const record = value as Record<string, unknown>;
  const { entry_function, input, output, invariants } = record;
  if (Object.keys(record).length !== 4) throw new StoreError('invariants-shape');
  if (typeof entry_function !== 'string' || typeof input !== 'string' || typeof output !== 'string' || !isStringArray(invariants)) {
    throw new StoreError('invariants-shape');
  }
  return { entry_function, input, output, invariants };
}

type CorpseView = { id: string; status: CorpseStatus };

export function seanceBody(source: ResultSource, row: SeanceRow, corpse: CorpseView): SeanceResponse {
  return {
    ok: true,
    source,
    seance: {
      id: row.id,
      requirementsMd: row.requirementsMd,
      designMd: row.designMd,
      invariants: parseInvariantsDocument(row.invariantsJson),
      approvedAt: row.approvedAt,
    },
    corpse: { id: corpse.id, status: corpse.status },
  };
}

export function reincarnationBody(source: ResultSource, row: ReincarnationRow, corpse: CorpseView): ReincarnationResponse {
  return {
    ok: true,
    source,
    reincarnation: {
      id: row.id,
      targetStack: row.targetStack,
      modernCode: row.modernCode,
      pbtTestCode: row.pbtTestCode,
      pbtPassed: row.pbtPassed,
      totalRuns: row.totalRuns,
      executionTimeMs: row.executionTimeMs,
      createdAt: row.createdAt,
      verification: verificationOf(row.pbtPassed),
      evidence: evidenceOf(row),
    },
    corpse: { id: corpse.id, status: corpse.status },
  };
}

/** Orders by line number, then by curse type in code-unit order. Returns a new array. */
export function sortCurses(curses: readonly CurseRowOut[]): CurseRowOut[] {
  return [...curses].sort((a, b) => a.lineNumber - b.lineNumber || (a.curseType < b.curseType ? -1 : a.curseType > b.curseType ? 1 : 0));
}

export function scanBody(source: 'precomputed' | 'generated', lineCount: number, curses: readonly CurseRowOut[]): ScanResponse {
  return {
    ok: true,
    source,
    lineCount,
    curses: curses.map((curse) => ({
      curseType: curse.curseType,
      severity: curse.severity,
      lineNumber: curse.lineNumber,
      description: curse.description,
      exorcismStrategy: curse.exorcismStrategy,
    })),
  };
}

/** A new or copied Séance moves an INFECTED corpse to IN_SEANCE. Every other case keeps the status. */
export function nextStatusAfterSeance(source: ResultSource, current: CorpseStatus): CorpseStatus {
  return (source === 'generated' || source === 'cache') && current === 'INFECTED' ? 'IN_SEANCE' : current;
}

/** A reincarnation whose run passed resurrects the corpse. A missing or failed run changes nothing. */
export function nextStatusAfterReincarnation(row: Pick<ReincarnationRow, 'pbtPassed'>, current: CorpseStatus): CorpseStatus {
  return row.pbtPassed === true && current !== 'RESURRECTED' ? 'RESURRECTED' : current;
}
