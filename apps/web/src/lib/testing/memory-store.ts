// An in-memory PipelineStore for the route tests. Test-only: no production module imports this file.
// It applies the same visibility rule as Row Level Security (samples and the member's own corpses), enforces
// the unique `corpse_id` of both result tables, supports scripted failures, can inject a conflicting row just
// before an insert (race simulation), and records every write.
import { QuotaUnavailable, StoreError } from '@/lib/pipeline/errors';
import { LIMITS } from '@/lib/pipeline/limits';
import type { PipelineStore } from '@/lib/pipeline/store';
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
  StatusChange,
  StatusUpdate,
} from '@/lib/pipeline/types';

export type MemoryCorpse = CorpseRow & { createdAt: string };

export type WriteRecord =
  | { kind: 'quota.reserve'; route: 'seance' | 'reincarnate' }
  | { kind: 'seance.insert'; row: NewSeance; result: 'inserted' | 'conflict' }
  | { kind: 'reincarnation.insert'; row: NewReincarnation; result: 'inserted' | 'conflict' }
  | { kind: 'curses.replace'; corpseId: string; count: number }
  | { kind: 'corpse.status'; corpseId: string; to: StatusChange['to']; updated: boolean };

/** One scripted answer of the quota call: a verdict, a thrown error, or a raw value that the route must distrust. */
export type QuotaScript = QuotaVerdict | { throws: unknown } | { raw: unknown };

export type StoreMethod = keyof PipelineStore;

export interface MemoryStoreOptions {
  /** The caller. null is a Visitor, who sees only the samples. */
  memberId: string | null;
  corpses?: MemoryCorpse[];
  seances?: SeanceRow[];
  reincarnations?: ReincarnationRow[];
  curses?: Record<string, CurseRowOut[]>;
  quota?: QuotaScript[];
  /** Shared event log. The store pushes `store:<method>` for every call. */
  timeline?: string[];
}

const BASE_TIME = Date.UTC(2026, 0, 1);

export class MemoryStore implements PipelineStore {
  readonly writes: WriteRecord[] = [];
  /** Names of the store methods that were called, in order. */
  readonly calls: StoreMethod[] = [];
  readonly timeline: string[];
  /** Runs just before an insert, so a test can add a conflicting row (a concurrent request). */
  beforeInsertSeance: ((store: MemoryStore) => void | Promise<void>) | undefined;
  beforeInsertReincarnation: ((store: MemoryStore) => void | Promise<void>) | undefined;

  private readonly memberId: string | null;
  private readonly corpses = new Map<string, MemoryCorpse>();
  private readonly seances = new Map<string, SeanceRow>();
  private readonly reincarnations = new Map<string, ReincarnationRow>();
  private readonly curses = new Map<string, CurseRowOut[]>();
  private readonly quotaScript: QuotaScript[];
  private readonly failures = new Map<StoreMethod, { error: unknown; remaining: number }>();
  private counter = 0;

  constructor(options: MemoryStoreOptions) {
    this.memberId = options.memberId;
    this.timeline = options.timeline ?? [];
    this.quotaScript = [...(options.quota ?? [])];
    for (const corpse of options.corpses ?? []) this.corpses.set(corpse.id, corpse);
    for (const row of options.seances ?? []) this.seances.set(row.corpseId, row);
    for (const row of options.reincarnations ?? []) this.reincarnations.set(row.corpseId, row);
    for (const [corpseId, rows] of Object.entries(options.curses ?? {})) this.curses.set(corpseId, [...rows]);
  }

  // --- Test controls (not part of PipelineStore) ---------------------------------------------

  /** Makes the next `times` calls of a method throw `error`. */
  failOn(method: StoreMethod, error: unknown = new StoreError('42P01'), times = Number.POSITIVE_INFINITY): void {
    this.failures.set(method, { error, remaining: times });
  }
  addCorpse(corpse: MemoryCorpse): void {
    this.corpses.set(corpse.id, corpse);
  }
  addSeance(row: SeanceRow): void {
    this.seances.set(row.corpseId, row);
  }
  addReincarnation(row: ReincarnationRow): void {
    this.reincarnations.set(row.corpseId, row);
  }
  corpseOf(id: string): MemoryCorpse | undefined {
    return this.corpses.get(id);
  }
  seanceOf(corpseId: string): SeanceRow | undefined {
    return this.seances.get(corpseId);
  }
  reincarnationOf(corpseId: string): ReincarnationRow | undefined {
    return this.reincarnations.get(corpseId);
  }
  cursesOf(corpseId: string): CurseRowOut[] {
    return [...(this.curses.get(corpseId) ?? [])];
  }
  get seanceCount(): number {
    return this.seances.size;
  }
  get reincarnationCount(): number {
    return this.reincarnations.size;
  }
  /** How many times the quota function was called, whatever its answer. */
  get quotaCalls(): number {
    return this.calls.filter((method) => method === 'reserveQuota').length;
  }
  writesOfKind<K extends WriteRecord['kind']>(kind: K): Array<Extract<WriteRecord, { kind: K }>> {
    return this.writes.filter((write): write is Extract<WriteRecord, { kind: K }> => write.kind === kind);
  }

  // --- Internals -------------------------------------------------------------------------------

  private enter(method: StoreMethod): void {
    this.calls.push(method);
    this.timeline.push(`store:${method}`);
    const failure = this.failures.get(method);
    if (failure && failure.remaining > 0) {
      failure.remaining -= 1;
      throw failure.error;
    }
  }
  private isVisible(corpse: MemoryCorpse | undefined): corpse is MemoryCorpse {
    return corpse !== undefined && (corpse.isSample || (this.memberId !== null && corpse.userId === this.memberId));
  }
  private visibleParent(corpseId: string): boolean {
    return this.isVisible(this.corpses.get(corpseId));
  }
  private nextTime(): string {
    this.counter += 1;
    return new Date(BASE_TIME + this.counter * 1_000).toISOString();
  }

  // --- PipelineStore -----------------------------------------------------------------------------

  async loadCorpse(id: string): Promise<CorpseRow | null> {
    this.enter('loadCorpse');
    const corpse = this.corpses.get(id);
    if (!this.isVisible(corpse)) return null;
    return {
      id: corpse.id,
      userId: corpse.userId,
      isSample: corpse.isSample,
      sourceLanguage: corpse.sourceLanguage,
      originalCode: corpse.originalCode,
      codeHash: corpse.codeHash,
      status: corpse.status,
    };
  }

  async getSeance(corpseId: string): Promise<SeanceRow | null> {
    this.enter('getSeance');
    return this.visibleParent(corpseId) ? (this.seances.get(corpseId) ?? null) : null;
  }

  async getReincarnation(corpseId: string): Promise<ReincarnationRow | null> {
    this.enter('getReincarnation');
    return this.visibleParent(corpseId) ? (this.reincarnations.get(corpseId) ?? null) : null;
  }

  async getCurses(corpseId: string): Promise<CurseRowOut[]> {
    this.enter('getCurses');
    return this.visibleParent(corpseId) ? this.cursesOf(corpseId) : [];
  }

  async listHashMatches(codeHash: string, excludeCorpseId: string): Promise<HashMatch[]> {
    this.enter('listHashMatches');
    return [...this.corpses.values()]
      .filter((corpse) => corpse.codeHash === codeHash && corpse.id !== excludeCorpseId && this.isVisible(corpse))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1))
      .slice(0, LIMITS.cacheCandidateLimit)
      .map((corpse) => ({ corpseId: corpse.id, userId: corpse.userId, isSample: corpse.isSample, createdAt: corpse.createdAt }));
  }

  async seancesFor(corpseIds: string[]): Promise<SeanceRow[]> {
    this.enter('seancesFor');
    return corpseIds.filter((id) => this.visibleParent(id)).flatMap((id) => this.seances.get(id) ?? []);
  }

  async reincarnationsFor(corpseIds: string[]): Promise<ReincarnationRow[]> {
    this.enter('reincarnationsFor');
    return corpseIds
      .filter((id) => this.visibleParent(id))
      .flatMap((id) => this.reincarnations.get(id) ?? [])
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
  }

  async insertSeance(row: NewSeance): Promise<InsertResult<SeanceRow>> {
    this.enter('insertSeance');
    await this.beforeInsertSeance?.(this);
    if (this.seances.has(row.corpseId)) {
      this.writes.push({ kind: 'seance.insert', row, result: 'conflict' });
      return { kind: 'conflict' };
    }
    this.counter += 1;
    const stored: SeanceRow = {
      id: `seance-${this.counter}`,
      corpseId: row.corpseId,
      requirementsMd: row.requirementsMd,
      designMd: row.designMd,
      invariantsJson: row.invariantsJson,
      approvedAt: row.approvedAt,
    };
    this.seances.set(row.corpseId, stored);
    this.writes.push({ kind: 'seance.insert', row, result: 'inserted' });
    return { kind: 'inserted', row: stored };
  }

  async insertReincarnation(row: NewReincarnation): Promise<InsertResult<ReincarnationRow>> {
    this.enter('insertReincarnation');
    await this.beforeInsertReincarnation?.(this);
    if (this.reincarnations.has(row.corpseId)) {
      this.writes.push({ kind: 'reincarnation.insert', row, result: 'conflict' });
      return { kind: 'conflict' };
    }
    const createdAt = this.nextTime();
    const stored: ReincarnationRow = {
      id: `reincarnation-${this.counter}`,
      corpseId: row.corpseId,
      targetStack: row.targetStack,
      modernCode: row.modernCode,
      pbtTestCode: row.pbtTestCode,
      pbtPassed: row.pbtPassed,
      totalRuns: row.totalRuns,
      executionTimeMs: row.executionTimeMs,
      createdAt,
    };
    this.reincarnations.set(row.corpseId, stored);
    this.writes.push({ kind: 'reincarnation.insert', row, result: 'inserted' });
    return { kind: 'inserted', row: stored };
  }

  async replaceCurses(corpseId: string, curses: CurseRowOut[]): Promise<void> {
    this.enter('replaceCurses');
    // All or nothing: the previous rows stay when the call throws, so the write is recorded only on success.
    const corpse = this.corpses.get(corpseId);
    if (!this.isVisible(corpse) || corpse.isSample || corpse.userId !== this.memberId) throw new StoreError('42501');
    this.curses.set(corpseId, curses.map((curse) => ({ ...curse })));
    this.writes.push({ kind: 'curses.replace', corpseId, count: curses.length });
  }

  async setStatus(corpseId: string, change: StatusChange): Promise<StatusUpdate> {
    this.writes.push({ kind: 'corpse.status', corpseId, to: change.to, updated: false });
    const record = this.writes[this.writes.length - 1] as Extract<WriteRecord, { kind: 'corpse.status' }>;
    this.enter('setStatus');
    const corpse = this.corpses.get(corpseId);
    if (!this.isVisible(corpse)) return { updated: false };
    const matches = change.to === 'IN_SEANCE' ? corpse.status === 'INFECTED' : corpse.status !== 'RESURRECTED';
    if (!matches) return { updated: false };
    const status: CorpseStatus = change.to;
    corpse.status = status;
    record.updated = true;
    return { updated: true, status };
  }

  async reserveQuota(route: 'seance' | 'reincarnate'): Promise<QuotaVerdict> {
    this.enter('reserveQuota');
    const step: QuotaScript = (this.quotaScript.length > 1 ? this.quotaScript.shift() : this.quotaScript[0]) ?? { allowed: true };
    if ('throws' in step) throw step.throws;
    if ('raw' in step) return step.raw as QuotaVerdict;
    if (step.allowed) this.writes.push({ kind: 'quota.reserve', route });
    return step;
  }
}

/** Convenience: the quota function failing the way the real wrapper does. */
export const quotaUnavailable = (): QuotaScript => ({ throws: new QuotaUnavailable('test') });
