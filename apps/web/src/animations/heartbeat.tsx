'use client';

import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { gsap, useGSAP } from './gsap';
import { MOTION_QUERY } from './motion-math';

/** One beat: a flat line, a spike, and a flat line again. */
const TRACE = 'M0 12 H40 L46 4 L52 20 L58 2 L64 22 L70 12 H120';

/**
 * The pending indicator of the stage controls (09-motion-ux Requirement 4). It is indeterminate on purpose: the routes
 * return one JSON document and report no progress, so the beat repeats at a fixed pace and never depends on elapsed time.
 * With reduced motion the whole line stays visible and still.
 */
export function Heartbeat({ className }: { className?: string }) {
  const ref = useRef<SVGSVGElement>(null);

  useGSAP(
    () => {
      const path = ref.current?.querySelector('path');
      if (!path) return;
      const media = gsap.matchMedia();
      media.add(MOTION_QUERY, () => {
        gsap
          .timeline({ repeat: -1 })
          .fromTo(path, { drawSVG: '0% 0%' }, { drawSVG: '0% 100%', duration: 1.1, ease: 'power1.inOut' })
          .to(path, { drawSVG: '100% 100%', duration: 0.5, ease: 'power1.in' });
      });
      return () => media.revert();
    },
    { scope: ref },
  );

  return (
    <svg
      ref={ref}
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 120 24"
      className={cn('block h-6 w-40 text-muted-foreground', className)}
    >
      <path d={TRACE} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
