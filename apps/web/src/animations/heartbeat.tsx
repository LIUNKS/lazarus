'use client';

import { useRef } from 'react';
import { HEARTBEAT_FLAT_D, HEARTBEAT_PULSE_D } from '@/components/icons';
import { cn } from '@/lib/utils';
import { gsap, useGSAP } from './gsap';
import { MOTION_QUERY } from './motion-math';

/**
 * The pending indicator of the stage controls (09-motion-ux Requirement 4). It is indeterminate on purpose: the routes
 * return one JSON document and report no progress, so the line morphs between flat and a heartbeat at a fixed pace and
 * never depends on elapsed time. With reduced motion the heartbeat line stays visible and still.
 */
export function Heartbeat({ className }: { className?: string }) {
  const ref = useRef<SVGSVGElement>(null);

  useGSAP(
    () => {
      const path = ref.current?.querySelector('path');
      if (!path) return;
      const media = gsap.matchMedia();
      media.add(MOTION_QUERY, () => {
        gsap.fromTo(
          path,
          { morphSVG: HEARTBEAT_FLAT_D },
          { morphSVG: HEARTBEAT_PULSE_D, duration: 0.7, ease: 'power2.inOut', repeat: -1, yoyo: true, repeatDelay: 0.15 },
        );
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
      viewBox="0 0 70 28"
      className={cn('block h-7 w-[70px] text-primary', className)}
    >
      <path d={HEARTBEAT_PULSE_D} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
