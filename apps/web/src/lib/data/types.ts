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
    return { id: text(curse, 'id'), curseType: text(curse, 'curse_type'), severity: text(curse, 'severity'), lineNumber };
  });
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