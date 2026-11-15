// Row types and runtime guards for what the Data API returns. A row with an unexpected shape is a DataError.

export const CORPSE_STATUSES = ['INFECTED', 'IN_SEANCE', 'RESURRECTED', 'FAILED'] as const;
export type CorpseStatus = (typeof CORPSE_STATUSES)[number];

export const SOURCE_LANGUAGES = ['es3', 'es5-jquery', 'legacy-node'] as const;
export type SourceLanguage = (typeof SOURCE_LANGUAGES)[number];

export interface CorpseSummary {
  id: string;
  title: string;
  sourceLanguage: SourceLanguage;
  status: CorpseStatus;
  createdAt: string;
  isSample: boolean;
  curseCount: number;
}

export interface CurseRow {
  id: string;
  curseType: string;
  severity: string;
  lineNumber: number;
  description: string;
  exorcismStrategy: string;
}

/** The parsed `seance_specs.invariants_json` (Requirement 2 criterion 5). */
export interface InvariantsDocument {
  entryFunction: string;
  input: string;
  output: string;
  invariants: string[];
}

export interface SeanceSpec {
  id: string;
  requirementsMd: string;
  designMd: string;
  /** null when the stored invariants are unreadable; the page still renders. */
  invariants: InvariantsDocument | null;
  approvedAt: string | null;
}

export interface Reincarnation {
  id: string;
  targetStack: string;
  modernCode: string;
  pbtTestCode: string;
  pbtPassed: boolean | null;
  totalRuns: number | null;
  executionTimeMs: number | null;
  createdAt: string;
}

export interface CorpseDetail extends CorpseSummary {
  originalCode: string;
  repoUrl: string | null;
  userId: string | null;
  curses: CurseRow[];
}

/** A failure to read or write data. The message is generic and safe to log; it never carries database text. */
export class DataError extends Error {
  constructor(message = 'The data request failed.') {
    super(message);
    this.name = 'DataError';
  }
}

type Row = Record<string, unknown>;

function asRow(value: unknown): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new DataError('Unexpected row shape.');
  return value as Row;
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new DataError(`Unexpected type for ${key}.`);
  return value;
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new DataError(`Unexpected type for ${key}.`);
  return value;
}

function nullableNumber(row: Row, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number') throw new DataError(`Unexpected type for ${key}.`);
  return value;
}

function nullableBoolean(row: Row, key: string): boolean | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'boolean') throw new DataError(`Unexpected type for ${key}.`);
  return value;
}

function oneOf<T extends string>(row: Row, key: string, allowed: readonly T[]): T {
  const value = text(row, key);
  if (!(allowed as readonly string[]).includes(value)) throw new DataError(`Unexpected value for ${key}.`);
  return value as T;
}

function embeddedCount(row: Row): number {
  const curses = row['curses'];
  if (!Array.isArray(curses)) return 0;
  const first: unknown = curses[0];
  if (first === undefined) return 0;
  const count = asRow(first)['count'];
  if (typeof count !== 'number') throw new DataError('Unexpected curse count.');
  return count;
}

export function parseSummary(value: unknown): CorpseSummary {
  const row = asRow(value);
  return {
    id: text(row, 'id'),
    title: text(row, 'title'),
    sourceLanguage: oneOf(row, 'source_language', SOURCE_LANGUAGES),
    status: oneOf(row, 'status', CORPSE_STATUSES),
    createdAt: text(row, 'created_at'),
    isSample: row['is_sample'] === true,
    curseCount: embeddedCount(row),
  };
}

export function parseDetail(value: unknown): CorpseDetail {
  const row = asRow(value);
  const rawCurses = row['curses'];
  const curses: CurseRow[] = (Array.isArray(rawCurses) ? rawCurses : []).map((item) => {
    const curse = asRow(item);
    const lineNumber = curse['line_number'];
    if (typeof lineNumber !== 'number') throw new DataError('Unexpected line number.');
    return {
      id: text(curse, 'id'),
      curseType: text(curse, 'curse_type'),
      severity: text(curse, 'severity'),
      lineNumber,
      description: text(curse, 'description'),
      exorcismStrategy: text(curse, 'exorcism_strategy'),
    };
  });
  // The query orders by line number only. The second key makes the order of two curses on one line deterministic.
  // The sort is stable, so equal pairs keep the order of the database.
  curses.sort((a, b) => a.lineNumber - b.lineNumber || (a.curseType < b.curseType ? -1 : a.curseType > b.curseType ? 1 : 0));
  const repoUrl = row['repo_url'];
  const userId = row['user_id'];
  return {
    id: text(row, 'id'),
    title: text(row, 'title'),
    sourceLanguage: oneOf(row, 'source_language', SOURCE_LANGUAGES),
    status: oneOf(row, 'status', CORPSE_STATUSES),
    createdAt: text(row, 'created_at'),
    isSample: row['is_sample'] === true,
    curseCount: curses.length,
    originalCode: text(row, 'original_code'),
    repoUrl: typeof repoUrl === 'string' && repoUrl !== '' ? repoUrl : null,
    userId: typeof userId === 'string' ? userId : null,
    curses,
  };
}
const INVARIANT_KEYS = ['entry_function', 'input', 'output', 'invariants'];

/**
 * Accepts an object with exactly the keys `entry_function`, `input`, `output` (non-empty strings) and `invariants`
 * (an array of strings, possibly empty). Anything else is null: unreadable invariants never fail the page.
 */
export function parseInvariants(value: unknown): InvariantsDocument | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Row;
  const keys = Object.keys(row);
  if (keys.length !== INVARIANT_KEYS.length || !INVARIANT_KEYS.every((key) => keys.includes(key))) return null;
  const { entry_function: entryFunction, input, output, invariants } = row;
  const nonEmpty = (item: unknown): item is string => typeof item === 'string' && item !== '';
  if (!nonEmpty(entryFunction) || !nonEmpty(input) || !nonEmpty(output)) return null;
  if (!Array.isArray(invariants) || !invariants.every((item): item is string => typeof item === 'string')) return null;
  return { entryFunction, input, output, invariants: [...invariants] };
}

export function parseSeanceSpec(value: unknown): SeanceSpec {
  const row = asRow(value);
  return {
    id: text(row, 'id'),
    requirementsMd: text(row, 'requirements_md'),
    designMd: text(row, 'design_md'),
    invariants: parseInvariants(row['invariants_json']),
    approvedAt: nullableText(row, 'approved_at'),
  };
}

export function parseReincarnation(value: unknown): Reincarnation {
  const row = asRow(value);
  return {
    id: text(row, 'id'),
    targetStack: text(row, 'target_stack'),
    modernCode: text(row, 'modern_code'),
    pbtTestCode: text(row, 'pbt_test_code'),
    // The run count and the duration are kept as stored. Judging them valid is the job of the verification view.
    pbtPassed: nullableBoolean(row, 'pbt_passed'),
    totalRuns: nullableNumber(row, 'total_runs'),
    executionTimeMs: nullableNumber(row, 'execution_time_ms'),
    createdAt: text(row, 'created_at'),
  };
}
