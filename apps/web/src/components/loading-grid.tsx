import { CandleIcon } from '@/components/icons';

/** Candle loader. The flame flickers only when motion is allowed (`.flame`); the text stays for screen readers. */
export function LoadingCandle({ label = 'Lighting the candles…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <CandleIcon className="size-6" />
      <span>{label}</span>
    </div>
  );
}

/** Static skeleton block (no pulse): the candle carries the motion. */
export function SkeletonBar({ className }: { className: string }) {
  return <div className={`rounded bg-muted ${className}`} />;
}

/** Reserves the layout of a corpse grid so content does not shift when data arrives. */
export function LoadingGrid({ count = 3 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4">
      <span className="sr-only">Loading</span>
      <LoadingCandle />
      <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className="flex h-[152px] flex-col gap-3 rounded-xl border border-border bg-card p-5">
            <SkeletonBar className="h-4 w-2/3" />
            <div className="flex gap-2">
              <SkeletonBar className="h-5 w-16" />
              <SkeletonBar className="h-5 w-20" />
            </div>
            <SkeletonBar className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}
