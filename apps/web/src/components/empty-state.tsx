import Link from 'next/link';
import type { ReactNode } from 'react';

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
    <div className="rounded-xl border border-dashed border-border p-8 text-center">
      <h3 className="text-lg font-medium">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{children}</p>
      {action ? (
        <Link href={action.href} className="mt-4 inline-block text-sm underline underline-offset-4">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}