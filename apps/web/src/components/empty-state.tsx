import Link from 'next/link';
import type { ReactNode } from 'react';
import { MausoleumArt } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <MausoleumArt className="mb-2 h-auto max-w-full" />
      <h3 className="font-serif text-xl font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{children}</p>
      {action ? (
        <Link href={action.href} className={cn(buttonVariants(), 'mt-2 min-h-11 px-4')}>
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
