import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Notice({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'curse';
  title?: string;
}) {
  return (
    <div
      role={tone === 'curse' ? 'alert' : 'status'}
      className={cn(
        'rounded-lg border px-4 py-3 text-sm',
        tone === 'curse' ? 'border-curse bg-curse/10 text-foreground' : 'border-border bg-card text-card-foreground',
      )}
    >
      {title ? <p className="mb-1 font-medium">{title}</p> : null}
      <div className="text-muted-foreground">{children}</div>
    </div>
  );
}