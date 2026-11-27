'use client';

import { useRef } from 'react';
import { EYE_CLOSED_D, EYE_OPEN_D } from '@/components/icons';
import { cn } from '@/lib/utils';
import { gsap, useGSAP } from './gsap';
import { MOTION_QUERY } from './motion-math';

/** The pending indicator of the Hex Scanner: the eye opens and closes while the scan runs. Still (open) with reduced motion. */
export function EyeAwake({ className }: { className?: string }) {
  const ref = useRef<SVGSVGElement>(null);

  useGSAP(
    () => {
      const lid = ref.current?.querySelector('[data-eye-lid]');
      if (!lid) return;
      const media = gsap.matchMedia();
      media.add(MOTION_QUERY, () => {
        gsap.fromTo(
          lid,
          { morphSVG: EYE_CLOSED_D },
          { morphSVG: EYE_OPEN_D, duration: 0.9, ease: 'power2.inOut', repeat: -1, yoyo: true, repeatDelay: 0.3 },
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
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('block size-7 text-curse-text', className)}
    >
      <circle cx="12" cy="12" r="9.5" />
      <path data-eye-lid d={EYE_OPEN_D} />
      <circle cx="12" cy="12" r="1.6" />
    </svg>
  );
}
