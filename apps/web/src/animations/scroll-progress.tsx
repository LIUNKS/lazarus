'use client';

import { useRef } from 'react';
import { gsap, ScrollTrigger, useGSAP } from './gsap';
import { MOTION_QUERY } from './motion-math';

/**
 * The Progress_Bar of the corpse page (09-motion-ux Requirement 7): a thin bar fixed at the top edge whose width follows
 * the scroll position. It is decoration and stays invisible with reduced motion. When the page height changes (the stage
 * sections stream in, a `details` element opens), the range is recomputed once per animation frame.
 */
export function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const bar = ref.current;
      if (!bar) return;
      const media = gsap.matchMedia();
      media.add(MOTION_QUERY, () => {
        gsap.set(bar, { opacity: 1 });
        gsap.fromTo(bar, { scaleX: 0 }, { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.3 } });
        let frame = 0;
        const observer = new ResizeObserver(() => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => ScrollTrigger.refresh());
        });
        observer.observe(document.body);
        return () => {
          cancelAnimationFrame(frame);
          observer.disconnect();
        };
      });
      return () => media.revert();
    },
    { scope: ref },
  );

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-primary opacity-0 shadow-[0_0_8px] shadow-primary"
    />
  );
}
