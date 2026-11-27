import { ApproveSeanceForm } from '@/components/stages/approve-seance-form';
import { SpecMarkdown } from '@/components/stages/spec-markdown';
import { StageActions } from '@/components/stages/stage-actions';
import type { SeanceSpec } from '@/lib/data/types';
import type { StageAccess, StageControls } from '@/lib/stages/controls';
import { ROUTE_COPY, SAMPLE_MIGRATION_HINT, stageHeadingId } from '@/lib/stages/copy';
import { formatDateUtc } from '@/lib/ui/format';

/** "Approved on YYYY-MM-DD" (UTC) or "Not approved yet", computed from the stored row only. */
function approvalText(seance: SeanceSpec): string {
  return seance.approvedAt === null ? 'Not approved yet' : `Approved on ${formatDateUtc(seance.approvedAt)}`;
}

/**
 * The extracted requirements, design, and invariants, with the approval state. For the owner, the first child holds the
 * start control and the approval form. It is always rendered for the owner, so the start control keeps its message when the
 * page refreshes after the séance was stored.
 */
export function SeancePanel({
  seance,
  access,
  controls,
  corpseId,
  currentPath,
}: {
  seance: SeanceSpec | null;
  access: StageAccess;
  controls: StageControls;
  corpseId: string;
  currentPath: string;
}) {
  const owner = access === 'owner';
  const copy = ROUTE_COPY.seance;
  return (
    <div className="space-y-4">
      {owner ? (
        <div className="space-y-3">
          <StageActions
            route="seance"
            corpseId={corpseId}
            available={controls.seance.available}
            label={copy.label}
            note={copy.note}
            pendingText={copy.pendingText}
            headingId={stageHeadingId('seance-chamber')}
            currentPath={currentPath}
          />
          {controls.approve.available ? <ApproveSeanceForm corpseId={corpseId} /> : null}
        </div>
      ) : null}
      {seance === null ? (
        <div data-reveal className="space-y-1 text-sm text-muted-foreground">
          <p>No séance is stored for this corpse.</p>
          {owner ? null : <p>{SAMPLE_MIGRATION_HINT}</p>}
        </div>
      ) : (
        <div data-reveal className="parchment space-y-6 [&_strong]:font-semibold [&_strong]:text-spectral rounded-md border border-spectral p-6 shadow-[0_0_40px_rgb(167_139_250/0.12)] sm:px-9 sm:py-8">
          <p className="text-sm">
            <span className="font-medium">Approval: </span>
            <span className="font-semibold text-spectral">{approvalText(seance)}</span>
          </p>
          <div className="space-y-2">
            <h3 id="seance-requirements-heading" className="font-serif text-xl font-semibold tracking-wide">
              Requirements
            </h3>
            <div role="region" aria-labelledby="seance-requirements-heading" tabIndex={0} className="leading-relaxed">
              <SpecMarkdown source={seance.requirementsMd} />
            </div>
          </div>
          <hr className="border-spectral/35" />
          <div className="space-y-2">
            <h3 id="seance-design-heading" className="font-serif text-xl font-semibold tracking-wide">
              Design
            </h3>
            <div role="region" aria-labelledby="seance-design-heading" tabIndex={0} className="leading-relaxed">
              <SpecMarkdown source={seance.designMd} />
            </div>
          </div>
          <hr className="border-spectral/35" />
          <div className="space-y-2">
            <h3 className="font-serif text-xl font-semibold tracking-wide">Invariants</h3>
            {seance.invariants === null ? (
              <p className="text-sm text-muted-foreground">The stored invariants could not be read.</p>
            ) : (
              <div className="space-y-2 text-sm leading-relaxed">
                <p>
                  <span className="font-medium">Entry function: </span>
                  <code className="rounded bg-muted px-1 font-mono text-[0.85em]">{seance.invariants.entryFunction}</code>
                </p>
                <p>
                  <span className="font-medium">Input: </span>
                  {seance.invariants.input}
                </p>
                <p>
                  <span className="font-medium">Output: </span>
                  {seance.invariants.output}
                </p>
                <ul aria-label="Invariants" className="list-disc space-y-1 pl-6">
                  {seance.invariants.invariants.map((invariant, index) => (
                    <li key={index}>{invariant}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
