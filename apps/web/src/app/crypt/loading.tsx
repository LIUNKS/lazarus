import { LoadingGrid } from '@/components/loading-grid';

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="h-9 w-40 animate-pulse rounded bg-card" />
      <LoadingGrid />
    </div>
  );
}