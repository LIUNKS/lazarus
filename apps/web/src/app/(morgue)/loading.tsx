import { LoadingGrid, SkeletonBar } from '@/components/loading-grid';

export default function Loading() {
  return (
    <div className="space-y-10">
      <div className="space-y-3" aria-hidden="true">
        <SkeletonBar className="h-9 w-48" />
        <SkeletonBar className="h-5 w-full max-w-2xl" />
      </div>
      <LoadingGrid />
    </div>
  );
}
