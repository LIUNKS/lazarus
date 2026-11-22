'use client';

import { useRef, type ReactNode } from 'react';
import { useReveal, type RevealTrigger } from './use-reveal';

/**
 * Wraps content and fades in its `[data-reveal]` descendants: all at once on first load (`trigger="load"`, the default)
 * or each one when it scrolls into view (`trigger="scroll"`).
 */
export function Reveal({
  children,
  className,
  selector = '[data-reveal]',
  stagger,
  trigger = 'load',
}: {
  children: ReactNode;
  className?: string;
  selector?: string;
  stagger?: number;
  trigger?: RevealTrigger;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref, selector, stagger === undefined ? { trigger } : { stagger, trigger });
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
