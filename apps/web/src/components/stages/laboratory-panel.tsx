import { EvidenceArrival } from '@/animations/evidence-arrival';
import { CodeView } from '@/components/code-view';
import { StageActions } from '@/components/stages/stage-actions';
import { VerificationEvidence } from '@/components/stages/verification-evidence';
import type { Reincarnation } from '@/lib/data/types';
import { VERIFY_SAMPLE_HELP_TEXT, type StageAccess, type StageControls } from '@/lib/stages/controls';
import { ROUTE_COPY, SAMPLE_MIGRATION_HINT, stageHeadingId } from '@/lib/stages/copy';
import { buildVerificationView } from '@/lib/stages/verification';
import { formatDateUtc } from '@/lib/ui/format';

/**
 * The resurrected TypeScript, its property-based test, and the verification evidence.
 *
 * Two `StageActions` instances can exist, both only for the owner, and each one sits at a fixed place in the tree so that it
 * stays mounted, with its message, when the page refreshes after a success:
 * - the reincarnation control is the first child, always rendered for the owner;
 * - the "Verify live" control sits directly below the evidence block, always rendered for an owner who has a stored
 *   reincarnation. After a verification the stored state is final, `available` becomes false, the button disappears, and the
 *   success message stays. While the server has live verification switched off, `available` is false from the start and
 *   the owner reads a short reason below the evidence instead of a button.
 * A Visitor gets neither control, and no `StageActions` element at all. A Member looking at a sample gets the "Verify live"
 * control only while the server runs sample verification, with a help text that says the result is not stored.
 */
export function LaboratoryPanel({
  reincarnation,
  access,
  controls,
  corpseId,
  currentPath,
}: {
  reincarnation: Reincarnation | null;
  access: StageAccess;
  controls: StageControls;
  corpseId: string;
  currentPath: string;
}) {
  const owner = access === 'owner';
  const headingId = stageHeadingId('laboratory');
  const reincarnate = ROUTE_COPY.reincarnate;
  const verify = ROUTE_COPY.verify;
  // The owner keeps the control mounted so its message stays after the refresh. A Member on a sample gets it only while
  // it is offered, and there it stays offered after a run, because a live sample run stores nothing.
  const showVerify = owner || controls.verify.available;
  const verifyNote = owner ? verify.note : VERIFY_SAMPLE_HELP_TEXT;
  const reason = !controls.reincarnate.available ? controls.reincarnate.reason : null;
  const verifyReason = !controls.verify.available ? controls.verify.reason : null;
  // Only the owner's run stores a result, so only then is the "no stored result" sentence replaced by the button.
  const view =
    reincarnation === null ? null : buildVerificationView(reincarnation, { verifyAvailable: owner && controls.verify.available });

  return (
    <div className="space-y-4">
      {owner ? (
        <StageActions
          route="reincarnate"
          corpseId={corpseId}
          available={controls.reincarnate.available}
          label={reincarnate.label}
          note={reincarnate.note}
          pendingText={reincarnate.pendingText}
          headingId={headingId}
          currentPath={currentPath}
        />
      ) : null}
      {owner && reason !== null ? <p className="text-sm text-muted-foreground">{reason}</p> : null}
      {reincarnation === null || view === null ? (
        <div data-reveal className="space-y-1 text-sm text-muted-foreground">
          <p>No reincarnation is stored for this corpse.</p>
          {owner ? null : <p>{SAMPLE_MIGRATION_HINT}</p>}
        </div>
      ) : (
        <>
          <EvidenceArrival runCount={view.runCount} tone={view.tone}>
            <VerificationEvidence view={view} />
          </EvidenceArrival>
          {showVerify ? (
            <StageActions
              route="verify"
              corpseId={corpseId}
              available={controls.verify.available}
              label={verify.label}
              note={verifyNote}
              pendingText={verify.pendingText}
              headingId={headingId}
              currentPath={currentPath}
            />
          ) : null}
          {owner && verifyReason !== null ? <p className="text-sm text-muted-foreground">{verifyReason}</p> : null}
          <p data-reveal className="text-sm text-muted-foreground">
            Target stack: {reincarnation.targetStack}. Created{' '}
            <time dateTime={reincarnation.createdAt}>{formatDateUtc(reincarnation.createdAt)}</time>.
          </p>
          <div data-reveal>
            <CodeView
              code={reincarnation.modernCode}
              label="Resurrected TypeScript"
              idPrefix="modern"
              tone={view.tone === 'verified' ? 'verified' : 'default'}
            />
          </div>
          <details data-reveal className="panel">
            <summary className="cursor-pointer rounded-md px-4 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">Property-based test</summary>
            <div className="p-3">
              <CodeView code={reincarnation.pbtTestCode} label="Property-based test" idPrefix="pbt" />
            </div>
          </details>
        </>
      )}
    </div>
  );
}
