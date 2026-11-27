import { Reveal } from '@/animations/reveal-section';
import { ErrorState } from '@/components/error-state';
import { HexScannerPanel } from '@/components/stages/hex-scanner-panel';
import { LaboratoryPanel } from '@/components/stages/laboratory-panel';
import { ReadonlyNotice } from '@/components/stages/readonly-notice';
import { SeancePanel } from '@/components/stages/seance-panel';
import { StageOverview } from '@/components/stages/stage-overview';
import { StageSection } from '@/components/stages/stage-section';
import type { Viewer } from '@/lib/auth/viewer';
import { loadStages } from '@/lib/data/load-stages';
import type { CorpseDetail, Reincarnation, SeanceSpec } from '@/lib/data/types';
import { resolveAccess, stageControls, summarizeStages, type StageAccess, type StageFacts } from '@/lib/stages/controls';
import type { ScannerView } from '@/lib/stages/scanner-view';
import { verificationState } from '@/lib/stages/verification';
import { effectiveExecution, effectiveSampleExecution } from '@/lib/verification/execution';

function factsOf(
  corpse: CorpseDetail,
  seance: SeanceSpec | null,
  reincarnation: Reincarnation | null,
  liveVerificationEnabled: boolean,
): StageFacts {
  return {
    curseCount: corpse.curseCount,
    hasSeance: seance !== null,
    seanceApproved: seance !== null && seance.approvedAt !== null,
    hasReincarnation: reincarnation !== null,
    verificationState: reincarnation === null ? null : verificationState(reincarnation),
    isSample: corpse.isSample,
    liveVerificationEnabled,
  };
}

/** The tombstone stepper for data that is already loaded. The page renders it above the source. */
export function StageOverviewView({
  corpse,
  seance,
  reincarnation,
  liveVerificationEnabled,
}: {
  corpse: CorpseDetail;
  seance: SeanceSpec | null;
  reincarnation: Reincarnation | null;
  liveVerificationEnabled: boolean;
}) {
  return <StageOverview summaries={summarizeStages(factsOf(corpse, seance, reincarnation, liveVerificationEnabled))} />;
}

/**
 * The three sections for data that is already loaded. It is synchronous, so tests render it to static
 * markup. For a Visitor and for a Member looking at a sample, no `StageActions` element is in the tree at all.
 */
export function StageSectionsView({
  corpse,
  access,
  seance,
  reincarnation,
  scannerView,
  liveVerificationEnabled,
}: {
  corpse: CorpseDetail;
  access: StageAccess;
  seance: SeanceSpec | null;
  reincarnation: Reincarnation | null;
  scannerView: ScannerView;
  /** The server-side execution decision for this corpse. While it is false, the "Verify live" control is not offered. */
  liveVerificationEnabled: boolean;
}) {
  const facts = factsOf(corpse, seance, reincarnation, liveVerificationEnabled);
  const controls = stageControls(access, facts);
  const currentPath = `/corpses/${corpse.id}`;

  return (
    <div className="space-y-8">
      <ReadonlyNotice access={access} currentPath={currentPath} />
      <Reveal className="space-y-10" trigger="scroll">
        <StageSection id="hex-scanner" title="Hex Scanner">
          <HexScannerPanel view={scannerView} access={access} controls={controls} corpseId={corpse.id} currentPath={currentPath} />
        </StageSection>
        <StageSection id="seance-chamber" title="Séance Chamber">
          <SeancePanel seance={seance} access={access} controls={controls} corpseId={corpse.id} currentPath={currentPath} />
        </StageSection>
        <StageSection id="laboratory" title="Laboratory">
          <LaboratoryPanel
            reincarnation={reincarnation}
            access={access}
            controls={controls}
            corpseId={corpse.id}
            currentPath={currentPath}
          />
        </StageSection>
      </Reveal>
    </div>
  );
}

function liveEnabled(corpse: CorpseDetail): boolean {
  // A sample is reviewed code and needs only the kill switch to be off. Imported code also needs the reviewed flag.
  return (corpse.isSample ? effectiveSampleExecution() : effectiveExecution()).enabled;
}

/**
 * The stepper above the source. `loadStages` is wrapped in React `cache()`, so this and `StageSections` share one request's
 * read. If the load fails, nothing renders here and `StageSections` shows the error state.
 */
export async function StageOverviewLoader({ corpse }: { corpse: CorpseDetail }) {
  let stages: Awaited<ReturnType<typeof loadStages>>;
  try {
    stages = await loadStages(corpse.id);
  } catch {
    return null;
  }
  return (
    <StageOverviewView
      corpse={corpse}
      seance={stages.seance}
      reincarnation={stages.reincarnation}
      liveVerificationEnabled={liveEnabled(corpse)}
    />
  );
}

/**
 * Loads the séance and the reincarnation with the Server_Client of the request, resolves the access from verified claims and
 * the corpse row, and renders the sections. If the load fails, the generic error state replaces the sections and the failure
 * is logged on the server without database text reaching the browser.
 */
export async function StageSections({
  corpse,
  viewer,
  scannerView,
}: {
  corpse: CorpseDetail;
  viewer: Viewer | null;
  scannerView: ScannerView;
}) {
  let stages: Awaited<ReturnType<typeof loadStages>>;
  try {
    stages = await loadStages(corpse.id);
  } catch (error) {
    // The data layer already logged a database failure. This line also covers a row with an unexpected shape.
    console.error(`[stages] Loading the stage data failed: ${error instanceof Error ? error.name : 'unknown error'}`);
    return <ErrorState what="the stage results" />;
  }
  const liveVerificationEnabled = liveEnabled(corpse);
  return (
    <StageSectionsView
      corpse={corpse}
      access={resolveAccess(viewer, corpse)}
      seance={stages.seance}
      reincarnation={stages.reincarnation}
      scannerView={scannerView}
      liveVerificationEnabled={liveVerificationEnabled}
    />
  );
}
