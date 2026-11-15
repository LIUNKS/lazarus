// The success body of POST /api/verify (Requirement 2 criteria 4 to 7). Pure module.
// It is built from the stored row only, never from a Sandbox_Result, and it uses the formatting functions of 05,
// so the evidence text is the same everywhere.
import { evidenceOf, verificationOf } from '@/lib/pipeline/present';
import type { CorpseStatus, ReincarnationRow, Verification } from '@/lib/pipeline/types';

export type VerifySource = 'precomputed' | 'stored' | 'executed';

export interface VerifyResponse {
  ok: true;
  source: VerifySource;
  reincarnation: {
    id: string;
    targetStack: string;
    pbtPassed: boolean | null;
    totalRuns: number | null;
    executionTimeMs: number | null;
    verification: Verification;
    evidence: string | null;
  };
  corpse: { id: string; status: CorpseStatus };
}

type StoredValues = Pick<ReincarnationRow, 'id' | 'targetStack' | 'pbtPassed' | 'totalRuns' | 'executionTimeMs'>;

export function verifyBody(source: VerifySource, row: StoredValues, corpse: { id: string; status: CorpseStatus }): VerifyResponse {
  return {
    ok: true,
    source,
    reincarnation: {
      id: row.id,
      targetStack: row.targetStack,
      pbtPassed: row.pbtPassed,
      totalRuns: row.totalRuns,
      executionTimeMs: row.executionTimeMs,
      verification: verificationOf(row.pbtPassed),
      evidence: evidenceOf(row),
    },
    corpse: { id: corpse.id, status: corpse.status },
  };
}
