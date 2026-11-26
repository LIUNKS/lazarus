import { LoadingGrid, SkeletonBar } from '@/components/loading-grid';

export default function Loading() {
  return (
    <div className="space-y-6">
      <SkeletonBar className="h-9 w-40" />
      <LoadingGrid />
    </div>
  );
}
