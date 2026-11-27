import { LoadingCandle, SkeletonBar } from '@/components/loading-grid';
import { StageOverviewSkeleton, StagesSkeleton } from '@/components/stages/stages-skeleton';

export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-8">
      <span className="sr-only">Loading</span>
      <LoadingCandle />
      <div className="space-y-3" aria-hidden="true">
        <SkeletonBar className="h-9 w-2/3" />
        <SkeletonBar className="h-5 w-1/3" />
      </div>
      <StageOverviewSkeleton />
      <div aria-hidden="true" className="h-80 rounded-lg border border-border bg-card" />
      <StagesSkeleton />
    </div>
  );
}
