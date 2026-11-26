import type { ReactNode } from 'react';
import { BloodDropSmallIcon } from '@/components/icons';
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
  const curse = tone === 'curse';
  return (
    <div
      role={tone === 'curse' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-lg border px-4 py-3 text-sm',
        curse ? 'border-curse bg-curse/10 text-foreground' : 'border-border bg-card text-card-foreground',
      )}
    >
      {curse ? <BloodDropSmallIcon className="mt-0.5 shrink-0 text-curse-text" /> : null}
      <div>
        {title ? <p className={cn('mb-1 font-semibold', curse && 'text-curse-text')}>{title}</p> : null}
        <div className={curse ? 'text-foreground' : 'text-muted-foreground'}>{children}</div>
      </div>
    </div>
  );
}
