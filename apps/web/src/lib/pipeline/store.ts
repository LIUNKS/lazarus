import 'server-only';

// The store seam over the Server_Client of the current request (Requirement 1 criterion 6). Every read and write
// goes through the client of the request, so Row Level Security decides what each caller sees. No second client
// exists, no service role key is used, and `getSession` is never called.
// The store never updates or deletes a row of `seance_specs` or `reincarnations`.
import type { SupabaseClient } from '@supabase/supabase-js';
import { SOURCE_LANGUAGES, CORPSE_STATUSES } from '@/lib/data/types';
import { StoreError } from './errors';
import { LIMITS } from './limits';
import { reserveQuota } from './quota';
import type {
  CorpseRow,
  CorpseStatus,
  CurseRowOut,
  HashMatch,
  InsertResult,
  NewReincarnation,
  NewSeance,
  QuotaVerdict,
  ReincarnationRow,
  SeanceRow,
  SourceLanguage,
  StatusChange,
  StatusUpdate,
} from './types';

export interface PipelineStore {
  loadCorpse(id: string): Promise<CorpseRow | null>;
  getSeance(corpseId: string): Promise<SeanceRow | null>;
  getReincarnation(corpseId: string): Promise<ReincarnationRow | null>;
  getCurses(corpseId: string): Promise<CurseRowOut[]>;
  /** Corpses with the same `code_hash`, newest first, at most `cacheCandidateLimit`. The corpse itself is excluded. */
  listHashMatches(codeHash: string, excludeCorpseId: string): Promise<HashMatch[]>;
  seancesFor(corpseIds: string[]): Promise<SeanceRow[]>;
  /** Newest first. */
  reincarnationsFor(corpseIds: string[]): Promise<ReincarnationRow[]>;
  insertSeance(row: NewSeance): Promise<InsertResult<SeanceRow>>;
  insertReincarnation(row: NewReincarnation): Promise<InsertResult<ReincarnationRow>>;
  replaceCurses(corpseId: string, curses: CurseRowOut[]): Promise<void>;
  setStatus(corpseId: string, change: StatusChange): Promise<StatusUpdate>;
  reserveQuota(route: 'seance' | 'reincarnate'): Promise<QuotaVerdict>;
}

type Row = Record<string, unknown>;

const UNIQUE_VIOLATION = '23505';
const CORPSE_COLUMNS = 'id,user_id,is_sample,source_language,original_code,code_hash,status';
const SEANCE_COLUMNS = 'id,corpse_id,requirements_md,design_md,invariants_json,approved_at';
const REINCARNATION_COLUMNS = 'id,corpse_id,target_stack,modern_code,pbt_test_code,pbt_passed,total_runs,execution_time_ms,created_at';
const CURSE_COLUMNS = 'curse_type,severity,line_number,description,exorcism_strategy';
const MATCH_COLUMNS = 'id,user_id,is_sample,created_at';

// ---------------------------------------------------------------------------------------------
// Row mappers with runtime guards. An unexpected shape is a StoreError with a constant detail.
// ---------------------------------------------------------------------------------------------

function asRow(value: unknown): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new StoreError('row-shape');
  return value as Row;
}
function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new StoreError('row-shape');
  return value;
}
function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new StoreError('row-shape');
  return value;
}
function nullableInt(row: Row, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new StoreError('row-shape');
  return value;
}
function nullableBool(row: Row, key: string): boolean | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'boolean') throw new StoreError('row-shape');
  return value;
}
function oneOf<T extends string>(row: Row, key: string, allowed: readonly T[]): T {
  const value = text(row, key);
  if (!(allowed as readonly string[]).includes(value)) throw new StoreError('row-shape');
  return value as T;
}

function toCorpse(value: unknown): CorpseRow {
  const row = asRow(value);
  return {
    id: text(row, 'id'),
    userId: nullableText(row, 'user_id'),
    isSample: row['is_sample'] === true,
    sourceLanguage: oneOf<SourceLanguage>(row, 'source_language', SOURCE_LANGUAGES),
    originalCode: text(row, 'original_code'),
    codeHash: text(row, 'code_hash'),
    status: oneOf<CorpseStatus>(row, 'status', CORPSE_STATUSES),
  };
}
function toSeance(value: unknown): SeanceRow {
  const row = asRow(value);
  return {
    id: text(row, 'id'),
    corpseId: text(row, 'corpse_id'),
    requirementsMd: text(row, 'requirements_md'),
    designMd: text(row, 'design_md'),
    invariantsJson: row['invariants_json'],
    approvedAt: nullableText(row, 'approved_at'),
  };
}
function toReincarnation(value: unknown): ReincarnationRow {
  const row = asRow(value);
  return {
    id: text(row, 'id'),
    corpseId: text(row, 'corpse_id'),
    targetStack: text(row, 'target_stack'),
    modernCode: text(row, 'modern_code'),
    pbtTestCode: text(row, 'pbt_test_code'),
    pbtPassed: nullableBool(row, 'pbt_passed'),
    totalRuns: nullableInt(row, 'total_runs'),
    executionTimeMs: nullableInt(row, 'execution_time_ms'),
    createdAt: text(row, 'created_at'),
  };
}
function toCurse(value: unknown): CurseRowOut {
  const row = asRow(value);
  const lineNumber = row['line_number'];
  if (typeof lineNumber !== 'number' || !Number.isInteger(lineNumber)) throw new StoreError('row-shape');
  return {
    curseType: text(row, 'curse_type'),
    severity: text(row, 'severity'),
    lineNumber,
    description: text(row, 'description'),
    exorcismStrategy: text(row, 'exorcism_strategy'),
  };
}
function toMatch(value: unknown): HashMatch {
  const row = asRow(value);
  return { corpseId: text(row, 'id'), userId: nullableText(row, 'user_id'), isSample: row['is_sample'] === true, createdAt: text(row, 'created_at') };
}

function rows(data: unknown): unknown[] {
  if (data === null || data === undefined) return [];
  if (!Array.isArray(data)) throw new StoreError('row-shape');
  return data;
}

/** The detail of a failure is the PostgREST or SQLSTATE code only. The database message is never copied. */
function failure(error: { code?: string } | null | undefined): StoreError {
  const code = error?.code;
  return new StoreError(typeof code === 'string' && /^[A-Za-z0-9_-]{1,12}$/.test(code) ? code : 'db');
}

export function createSupabaseStore(client: SupabaseClient): PipelineStore {
  return {
    async loadCorpse(id) {
      const { data, error } = await client.from('corpses').select(CORPSE_COLUMNS).eq('id', id).maybeSingle();
      if (error) throw failure(error);
      return data === null ? null : toCorpse(data);
    },

    async getSeance(corpseId) {
      const { data, error } = await client.from('seance_specs').select(SEANCE_COLUMNS).eq('corpse_id', corpseId).maybeSingle();
      if (error) throw failure(error);
      return data === null ? null : toSeance(data);
    },

    async getReincarnation(corpseId) {
      const { data, error } = await client.from('reincarnations').select(REINCARNATION_COLUMNS).eq('corpse_id', corpseId).maybeSingle();
      if (error) throw failure(error);
      return data === null ? null : toReincarnation(data);
    },

    async getCurses(corpseId) {
      const { data, error } = await client.from('curses').select(CURSE_COLUMNS).eq('corpse_id', corpseId);
      if (error) throw failure(error);
      return rows(data).map(toCurse);
    },

    async listHashMatches(codeHash, excludeCorpseId) {
      const { data, error } = await client
        .from('corpses')
        .select(MATCH_COLUMNS)
        .eq('code_hash', codeHash)
        .neq('id', excludeCorpseId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(LIMITS.cacheCandidateLimit);
      if (error) throw failure(error);
      return rows(data).map(toMatch);
    },

    async seancesFor(corpseIds) {
      if (corpseIds.length === 0) return [];
      const { data, error } = await client.from('seance_specs').select(SEANCE_COLUMNS).in('corpse_id', corpseIds);
      if (error) throw failure(error);
      return rows(data).map(toSeance);
    },

    async reincarnationsFor(corpseIds) {
      if (corpseIds.length === 0) return [];
      const { data, error } = await client
        .from('reincarnations')
        .select(REINCARNATION_COLUMNS)
        .in('corpse_id', corpseIds)
        .order('created_at', { ascending: false });
      if (error) throw failure(error);
      return rows(data).map(toReincarnation);
    },

    async insertSeance(row) {
      const { data, error } = await client
        .from('seance_specs')
        .insert({
          corpse_id: row.corpseId,
          requirements_md: row.requirementsMd,
          design_md: row.designMd,
          invariants_json: row.invariantsJson,
          approved_at: row.approvedAt,
        })
        .select(SEANCE_COLUMNS)
        .single();
      if (error?.code === UNIQUE_VIOLATION) return { kind: 'conflict' };
      if (error) throw failure(error);
      return { kind: 'inserted', row: toSeance(data) };
    },

    async insertReincarnation(row) {
      const { data, error } = await client
        .from('reincarnations')
        .insert({
          corpse_id: row.corpseId,
          target_stack: row.targetStack,
          modern_code: row.modernCode,
          pbt_test_code: row.pbtTestCode,
          pbt_passed: row.pbtPassed,
          total_runs: row.totalRuns,
          execution_time_ms: row.executionTimeMs,
        })
        .select(REINCARNATION_COLUMNS)
        .single();
      if (error?.code === UNIQUE_VIOLATION) return { kind: 'conflict' };
      if (error) throw failure(error);
      return { kind: 'inserted', row: toReincarnation(data) };
    },

    async replaceCurses(corpseId, curses) {
      const { error } = await client.rpc('replace_corpse_curses', {
        p_corpse_id: corpseId,
        p_curses: curses.map((curse) => ({
          curse_type: curse.curseType,
          severity: curse.severity,
          line_number: curse.lineNumber,
          description: curse.description,
          exorcism_strategy: curse.exorcismStrategy,
        })),
      });
      if (error) throw failure(error);
    },

    async setStatus(corpseId, change) {
      // The guard keeps a late request from overwriting a newer status.
      const base = client.from('corpses').update({ status: change.to }).eq('id', corpseId);
      const guarded = change.to === 'IN_SEANCE' ? base.eq('status', 'INFECTED') : base.neq('status', 'RESURRECTED');
      const { data, error } = await guarded.select('status');
      if (error) throw failure(error);
      const updated = rows(data);
      if (updated.length === 0) return { updated: false };
      return { updated: true, status: oneOf<CorpseStatus>(asRow(updated[0]), 'status', CORPSE_STATUSES) };
    },

    reserveQuota(route) {
      return reserveQuota(client, route);
    },
  };
}
