export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-8">
      <span className="sr-only">Loading</span>
      <div className="space-y-3">
        <div className="h-9 w-2/3 animate-pulse rounded bg-card" />
        <div className="h-5 w-1/3 animate-pulse rounded bg-card" />
      </div>
      <div className="h-80 animate-pulse rounded-lg border border-border bg-card" />
    </div>
  );
}