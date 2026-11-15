import type { StageSummary } from '@/lib/stages/controls';

/** Links to the three stages, with the state of each one in words. It is plain server-rendered HTML. */
export function StageOverview({ summaries }: { summaries: readonly StageSummary[] }) {
  return (
    <nav aria-label="Resurrection stages">
      <ol className="grid gap-3 sm:grid-cols-3">
        {summaries.map((summary) => (
          <li key={summary.id}>
            <a
              href={`#${summary.id}`}
              className="block rounded-lg border border-border bg-card p-3 transition-colors hover:bg-secondary"
            >
              <span className="block font-medium">{summary.name}</span>
              <span className="block text-sm text-muted-foreground">{summary.state}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
