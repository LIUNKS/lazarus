/** Reserves the layout of a corpse grid so content does not shift when data arrives. */
export function LoadingGrid({ count = 3 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <span className="sr-only">Loading</span>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="h-[152px] animate-pulse rounded-xl border border-border bg-card" />
      ))}
    </div>
  );
}