// An in-memory VerificationStore for the route tests. Test-only: no production module imports this file.
// The reads come from the MemoryStore of 05 (same visibility rule as Row Level Security). The quota answers come from
// a script. `recordVerification` follows the rule of the SQL function `record_verification`: it updates only an owned,
// visible row without a verdict, and moves the corpse to RESURRECTED or FAILED unless its status is already one of the
// two. Every write is recorded, and a hook can insert a competing verdict just before the record call (race).
import { StoreError } from '@/lib/pipeline/errors';
import type { CorpseRow, QuotaVerdict, ReincarnationRow, SeanceRow } from '@/lib/pipeline/types';
import type { RecordInput, RecordResult, VerificationStore } from '@/lib/verification/store';
import { MemoryStore, type MemoryCorpse, type QuotaScript } from './memory-store';

export type VerificationWrite =
  | { kind: 'quota.reserve' }
  | { kind: 'verification.record'; input: RecordInput; updated: boolean };

export type VerificationMethod = keyof VerificationStore;

export interface MemoryVerificationStoreOptions {
  /** The caller. null is a Visitor. */
  memberId: string | null;
  corpses?: MemoryCorpse[];
  seances?: SeanceRow[];
  reincarnations?: ReincarnationRow[];
  /** Scripted answers of the quota function, consumed one per call (the last one repeats). Default: allow. */
  quota?: QuotaScript[];
}

export class MemoryVerificationStore implements VerificationStore {
  readonly writes: VerificationWrite[] = [];
  /** Names of the store methods that were called, in order. */
  readonly calls: VerificationMethod[] = [];
  /** Runs just before the record call, so a test can store a competing verdict (a concurrent request). */
  beforeRecord: ((store: MemoryVerificationStore) => void | Promise<void>) | undefined;

  readonly reads: MemoryStore;
  private readonly memberId: string | null;
  private readonly quotaScript: QuotaScript[];
  private readonly failures = new Map<VerificationMethod, { error: unknown; remaining: number }>();
  /** Every corpse id the store holds, so a row can be found by its own id as the SQL function does. */
  private readonly corpseIds = new Set<string>();

  constructor(options: MemoryVerificationStoreOptions) {
    this.memberId = options.memberId;
    for (const corpse of options.corpses ?? []) this.corpseIds.add(corpse.id);
    this.quotaScript = [...(options.quota ?? [{ allowed: true }])];
    this.reads = new MemoryStore({
      memberId: options.memberId,
      corpses: options.corpses ?? [],
      seances: options.seances ?? [],
      reincarnations: options.reincarnations ?? [],
    });
  }

  // --- Test controls --------------------------------------------------------------------------

  /** Makes the next `times` calls of a method throw `error`. */
  failOn(method: VerificationMethod, error: unknown = new StoreError('42P01'), times = Number.POSITIVE_INFINITY): void {
    this.failures.set(method, { error, remaining: times });
  }
  get quotaCalls(): number {
    return this.calls.filter((method) => method === 'reserveVerificationRun').length;
  }
  get recordCalls(): number {
    return this.calls.filter((method) => method === 'recordVerification').length;
  }
  /** Writes to tables of the corpse (verdicts and statuses). The quota reservation is not one of them. */
  get verdictWrites(): Array<Extract<VerificationWrite, { kind: 'verification.record' }>> {
    return this.writes.filter((write): write is Extract<VerificationWrite, { kind: 'verification.record' }> => write.kind === 'verification.record');
  }
  get reservations(): number {
    return this.writes.filter((write) => write.kind === 'quota.reserve').length;
  }
  corpseOf(id: string): MemoryCorpse | undefined {
    return this.reads.corpseOf(id);
  }
  reincarnationOf(corpseId: string): ReincarnationRow | undefined {
    return this.reads.reincarnationOf(corpseId);
  }
  /** Stores a verdict directly, as a competing request or an owner with table access could. */
  storeVerdict(corpseId: string, values: Pick<ReincarnationRow, 'pbtPassed' | 'totalRuns' | 'executionTimeMs'>): void {
    const row = this.reads.reincarnationOf(corpseId);
    if (row === undefined) throw new Error(`no reincarnation for ${corpseId}`);
    this.reads.addReincarnation({ ...row, ...values });
  }

  private enter(method: VerificationMethod): void {
    this.calls.push(method);
    const failure = this.failures.get(method);
    if (failure && failure.remaining > 0) {
      failure.remaining -= 1;
      throw failure.error;
    }
  }

  // --- VerificationStore ------------------------------------------------------------------------

  async loadCorpse(id: string): Promise<CorpseRow | null> {
    this.enter('loadCorpse');
    return this.reads.loadCorpse(id);
  }

  async getSeance(corpseId: string): Promise<SeanceRow | null> {
    this.enter('getSeance');
    return this.reads.getSeance(corpseId);
  }

  async getReincarnation(corpseId: string): Promise<ReincarnationRow | null> {
    this.enter('getReincarnation');
    return this.reads.getReincarnation(corpseId);
  }

  async reserveVerificationRun(): Promise<QuotaVerdict> {
    this.enter('reserveVerificationRun');
    const step: QuotaScript = (this.quotaScript.length > 1 ? this.quotaScript.shift() : this.quotaScript[0]) ?? { allowed: true };
    if ('throws' in step) throw step.throws;
    if ('raw' in step) return step.raw as QuotaVerdict;
    if (step.allowed) this.writes.push({ kind: 'quota.reserve' });
    return step;
  }

  async recordVerification(input: RecordInput): Promise<RecordResult> {
    this.enter('recordVerification');
    if (this.beforeRecord) await this.beforeRecord(this);

    // Find the row by its id, as the SQL function does, then apply the rule of Row Level Security.
    let row: ReincarnationRow | undefined;
    let corpse: MemoryCorpse | undefined;
    for (const candidate of this.corpseIds) {
      const found = this.reads.reincarnationOf(candidate);
      if (found?.id === input.reincarnationId) {
        row = found;
        corpse = this.reads.corpseOf(candidate);
      }
    }
    const writable = row !== undefined && corpse !== undefined && !corpse.isSample && this.memberId !== null && corpse.userId === this.memberId;
    if (!writable || row === undefined || corpse === undefined || row.pbtPassed !== null) {
      this.writes.push({ kind: 'verification.record', input, updated: false });
      return { wasUpdated: false };
    }

    this.reads.addReincarnation({ ...row, pbtPassed: input.passed, totalRuns: input.totalRuns, executionTimeMs: input.executionTimeMs });
    const terminal = corpse.status === 'RESURRECTED' || corpse.status === 'FAILED';
    const corpseStatus = terminal ? corpse.status : input.passed ? 'RESURRECTED' : 'FAILED';
    this.reads.addCorpse({ ...corpse, status: corpseStatus });
    this.writes.push({ kind: 'verification.record', input, updated: true });
    return { wasUpdated: true, passed: input.passed, totalRuns: input.totalRuns, executionTimeMs: input.executionTimeMs, corpseStatus };
  }
}
