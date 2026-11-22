// The text that tells visitors and new members what they can do (10-onboarding-invites). Pure module: no framework
// imports, no process.env. Every number comes from the limit constants, so the page never promises more than the code.
import { IMPORT_LIMITS } from '@/lib/import/limits';
import { LIMITS } from '@/lib/pipeline/limits';
import { formatRunCount } from '@/lib/stages/format';
import { VERIFICATION_LIMITS } from '@/lib/verification/limits';

/** The server decisions for live verification, read per request (`effectiveExecution`, `effectiveSampleExecution`). */
export interface LiveFlags {
  ownCode: boolean;
  samples: boolean;
}

export interface Capability {
  lead: string;
  text: string;
}

/** The import limit in the unit that the import form uses (binary kilobytes). */
export const IMPORT_SIZE_LABEL = `${IMPORT_LIMITS.maxBytes / 1024} KB`;

/** The source limit of the Séance and the Reincarnation. A decimal byte count, so it is not written in KB. */
export const MODEL_SOURCE_LABEL = `${formatRunCount(LIMITS.maxLlmSourceBytes)} bytes`;

const RUNS = formatRunCount(VERIFICATION_LIMITS.numRuns);

/** What signing in adds, in workflow order. The live verification item appears only while the server runs it. */
export function capabilities(live: LiveFlags): Capability[] {
  const items: Capability[] = [
    { lead: 'Import', text: `your own legacy JavaScript (ES3, ES5/jQuery, or legacy Node), up to ${IMPORT_SIZE_LABEL} per file.` },
    { lead: 'Scan', text: 'it with the Hex Scanner to find its curses at their exact line numbers.' },
    { lead: 'Extract', text: 'its business logic in a Séance: EARS requirements, a design, and input/output invariants that you approve.' },
    {
      lead: 'Reincarnate',
      text: `it as strict TypeScript with a property-based test. The Séance and the Reincarnation accept sources up to ${MODEL_SOURCE_LABEL}.`,
    },
  ];
  if (live.ownCode) {
    items.push({ lead: 'Verify', text: `your reincarnation live against the legacy code across ${RUNS} generated inputs.` });
  } else if (live.samples) {
    items.push({ lead: 'Verify', text: `the sample corpses live, comparing legacy and modern code across ${RUNS} generated inputs.` });
  }
  items.push({ lead: 'Keep', text: `a private history of up to ${IMPORT_LIMITS.maxCorpses} corpses in The Crypt.` });
  return items;
}

/** The per-account limits. Both quota windows are one hour (checked in the tests). */
export function usageNote(live: LiveFlags): string {
  const generations = `${LIMITS.userQuota.limit} new Séance or Reincarnation generations`;
  if (!live.ownCode && !live.samples) return `Each account can start up to ${generations} per hour. Stored results are free to view.`;
  return `Each account can start up to ${generations} and ${VERIFICATION_LIMITS.userQuota.limit} live verifications per hour. Stored results are free to view.`;
}

/** Matches the default `user:email` scope of the Supabase GitHub provider. The sign-in call requests no other scope. */
export const TRUST_LINE = 'Lazarus asks GitHub only for your public profile and email address. It gets no access to your repositories.';

export const STAGES: readonly Capability[] = [
  { lead: 'The Morgue', text: 'Pick a sample corpse or import your own legacy JavaScript.' },
  { lead: 'Hex Scanner', text: 'A deterministic AST scan marks every curse at its exact line.' },
  { lead: 'Séance Chamber', text: 'The business logic is extracted into a spec with EARS requirements and invariants.' },
  { lead: 'Laboratory', text: 'Strict TypeScript is generated and compared with the legacy code over generated inputs.' },
];

export const FIRST_STEPS: readonly string[] = [
  `Import a legacy JavaScript file of up to ${IMPORT_SIZE_LABEL}.`,
  'Open it and run the Hex Scanner to see its curses.',
  'Start the Séance, read the generated spec, and approve it.',
  'Start the Reincarnation to get strict TypeScript and its property-based test.',
];
