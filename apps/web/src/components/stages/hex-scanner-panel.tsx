import { StageActions } from '@/components/stages/stage-actions';
import { Badge } from '@/components/ui/badge';
import type { StageAccess, StageControls } from '@/lib/stages/controls';
import { ROUTE_COPY, SAMPLE_MIGRATION_HINT, scanLabel, stageHeadingId } from '@/lib/stages/copy';
import { severityLabel, type ScannerView } from '@/lib/stages/scanner-view';
import { pluralize } from '@/lib/ui/format';

/**
 * The stored curses with their exact line numbers, a summary, and, for the owner, the scan control. The scan control is the
 * first child and always rendered for the owner, so it keeps its message when the page refreshes after a scan.
 */
export function HexScannerPanel({
  view,
  access,
  controls,
  corpseId,
  currentPath,
}: {
  view: ScannerView;
  access: StageAccess;
  controls: StageControls;
  corpseId: string;
  currentPath: string;
}) {
  const owner = access === 'owner';
  const copy = ROUTE_COPY.scan;
  return (
    <div className="space-y-4">
      {owner ? (
        <StageActions
          route="scan"
          corpseId={corpseId}
          available={controls.scan.available}
          label={scanLabel(view.total)}
          note={copy.note}
          pendingText={copy.pendingText}
          headingId={stageHeadingId('hex-scanner')}
          currentPath={currentPath}
        />
      ) : null}
      {view.total === 0 ? (
        <div data-reveal className="space-y-1 text-sm text-muted-foreground">
          <p>No curses are stored for this corpse.</p>
          {owner ? <p>Run the scan to look for curses.</p> : <p>{SAMPLE_MIGRATION_HINT}</p>}
        </div>
      ) : (
        <>
          <div data-reveal className="space-y-2">
            <p className="text-sm">{pluralize(view.total, 'curse')} stored.</p>
            <ul aria-label="Curses by severity" className="flex flex-wrap gap-2">
              {view.bySeverity.map((row) => (
                <li key={row.severity}>
                  <Badge variant="outline">
                    {severityLabel(row.severity)}: {row.count}
                  </Badge>
                </li>
              ))}
            </ul>
            <ul aria-label="Curses by type" className="flex flex-wrap gap-2">
              {view.byType.map((row) => (
                <li key={row.curseType}>
                  <Badge variant="secondary">
                    {row.label}: {row.count}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
          <ol aria-label="Curses by line" data-reveal className="divide-y divide-border rounded-lg border border-border">
            {view.entries.map((entry) => (
              <li key={entry.id} className="space-y-1 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{entry.label}</span>
                  <Badge className="bg-curse text-curse-foreground">{severityLabel(entry.severity)}</Badge>
                  {entry.anchor === null ? (
                    <span className="text-muted-foreground">Line {entry.lineNumber}</span>
                  ) : (
                    <a href={`#${entry.anchor}`} className="text-muted-foreground underline underline-offset-4">
                      Line {entry.lineNumber}
                    </a>
                  )}
                </div>
                <p>{entry.description}</p>
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Exorcism strategy: </span>
                  {entry.strategy}
                </p>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
