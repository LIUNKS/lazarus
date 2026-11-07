'use client';

import { useRef, type ReactNode } from 'react';
import { useReveal } from './use-reveal';

/** Wraps content and fades in its `[data-reveal]` descendants on first load. */
export function Reveal({
  children,
  className,
  selector = '[data-reveal]',
  stagger,
}: {
  children: ReactNode;
  className?: string;
  selector?: string;
  stagger?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref, selector, stagger === undefined ? undefined : { stagger });
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}