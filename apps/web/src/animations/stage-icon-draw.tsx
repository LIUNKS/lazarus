'use client';

import { useRef, type ReactNode } from 'react';
import { gsap, ScrollTrigger, useGSAP, withMotion } from './gsap';

/** Draws the strokes of a stage icon once when it first scrolls into view. The server HTML is the finished icon. */
export function StageIconDraw({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const root = ref.current;
      if (!root) return;
      return withMotion((safe) => {
        const play = safe(() => {
          gsap.fromTo(
            root.querySelectorAll('path, circle'),
            { drawSVG: '0%' },
            { drawSVG: '100%', duration: 0.9, ease: 'power2.out', stagger: 0.08, immediateRender: false, clearProps: 'all' },
          );
        });
        ScrollTrigger.create({ trigger: root, start: 'top 90%', once: true, onEnter: play });
      });
    },
    { scope: ref },
  );

  return (
    <span ref={ref} className="inline-flex">
      {children}
    </span>
  );
}
