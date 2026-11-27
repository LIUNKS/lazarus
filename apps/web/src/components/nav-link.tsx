'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Primary navigation link; marks the current section with aria-current and a brighter color. */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const current = href === '/' ? pathname === '/' : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'flex min-h-8 items-center transition-colors hover:text-foreground',
        current ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {children}
    </Link>
  );
}
