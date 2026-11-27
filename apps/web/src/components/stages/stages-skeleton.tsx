/** Reserves the space of the stepper, which sits above the source. */
export function StageOverviewSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-3 sm:grid-cols-3">
      {[0, 1, 2].map((index) => (
        <div key={index} className="h-16 animate-pulse rounded-lg border border-border bg-card" />
      ))}
    </div>
  );
}

/**
 * Reserves the space of the three sections while the stage data loads, so the page does not jump.
 * `loading.tsx` uses it too (after `StageOverviewSkeleton`), so both fallbacks have the same layout.
 */
export function StagesSkeleton() {
  return (
    <div aria-busy="true" className="space-y-8">
      <span className="sr-only">Loading the stages</span>
      {[0, 1, 2].map((index) => (
        <div key={index} className="space-y-3">
          <div className="h-7 w-40 animate-pulse rounded bg-card" />
          <div className="h-32 animate-pulse rounded-lg border border-border bg-card" />
        </div>
      ))}
    </div>
  );
}
