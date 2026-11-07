import { LoadingGrid } from '@/components/loading-grid';

export default function Loading() {
  return (
    <div className="space-y-10">
      <div className="space-y-3">
        <div className="h-9 w-48 animate-pulse rounded bg-card" />
        <div className="h-5 w-full max-w-2xl animate-pulse rounded bg-card" />
      </div>
      <LoadingGrid />
    </div>
  );
}