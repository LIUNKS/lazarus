// The fixed text of the stage controls (Requirement 8 criterion 8, Requirement 9 criterion 3, Requirement 18 criteria 3 and 6).
// Pure module: no framework imports, no process.env. The numbers of the request limit and of the verification limit are not
// stated here: they belong to the specs of the routes.
import { VERIFY_HELP_TEXT, VERIFY_LABEL, VERIFY_PENDING_TEXT, type StageSummary } from './controls';
import type { PipelineRoute } from './pipeline-client';

const MODEL_NOTE = 'Uses the language model. Counts toward your hourly request limit.';

export interface RouteCopy {
  /** The button label. For `scan` it depends on the stored curses, see `scanLabel`. */
  label: string;
  note: string;
  pendingText: string;
}

export const ROUTE_COPY: Record<PipelineRoute, RouteCopy> = {
  scan: {
    label: 'Run scan',
    note: 'Runs the deterministic scanner. No model request.',
    pendingText: 'Running the scan.',
  },
  seance: {
    label: 'Begin séance',
    note: MODEL_NOTE,
    pendingText: 'Running the séance. This can take up to two minutes.',
  },
  reincarnate: {
    label: 'Begin reincarnation',
    note: MODEL_NOTE,
    pendingText: 'Running the reincarnation. This can take up to two minutes.',
  },
  verify: {
    label: VERIFY_LABEL,
    note: VERIFY_HELP_TEXT,
    pendingText: VERIFY_PENDING_TEXT,
  },
};

/** "Run scan" for a corpse without stored curses, and "Scan again" once curses are stored (Requirement 8 criterion 2). */
export function scanLabel(curseCount: number): string {
  return curseCount > 0 ? 'Scan again' : 'Run scan';
}

/** The id of the heading of a stage section. The client component moves keyboard focus to it after a success. */
export function stageHeadingId(stage: StageSummary['id']): string {
  return `${stage}-heading`;
}

/** Shown in an empty section to a viewer who is not the owner: the samples are stored by the Foundation migrations. */
export const SAMPLE_MIGRATION_HINT = 'The sample results come from the database migrations. Run pnpm db:migrate to load them.';
