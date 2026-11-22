'use client';

import { useRef, type ReactNode } from 'react';
import { formatRunCount } from '@/lib/stages/format';
import type { StatusTone } from '@/lib/ui/status';
import { gsap, ScrollTrigger, useGSAP, withMotion } from './gsap';
import { countFrame } from './motion-math';

/**
 * The Evidence_Arrival (09-motion-ux Requirement 5). When the stored verification evidence scrolls into view, the run
 * count in its headline counts up to the stored value, and a verified result gets one emerald glow. It replays a stored
 * result only: it runs on first view and again after a page refresh changes the stored count or tone, never while a
 * request is pending. The headline ends with exactly its server-rendered text.
 */
export function EvidenceArrival({ children, runCount, tone }: { children: ReactNode; runCount: number | null; tone: StatusTone }) {
  const ref = useRef<HTMLDivElement>(null);
  const verified = tone === 'verified';

  useGSAP(
    () => {
      const root = ref.current;
      if (!root) return;
      const headline = root.querySelector<HTMLElement>('h3');
      const original = headline?.textContent ?? null;
      const countable = headline !== null && original !== null && runCount !== null && original.includes(formatRunCount(runCount));
      const restore = () => {
        if (!countable) return;
        headline.textContent = original;
        headline.removeAttribute('aria-label');
      };
      return withMotion((safe) => {
        const play = safe(() => {
          if (countable) {
            headline.setAttribute('aria-label', original);
            const counter = { value: 0 };
            gsap.to(counter, {
              value: runCount,
              duration: 1.2,
              ease: 'power2.out',
              onUpdate: () => {
                headline.textContent = countFrame(original, runCount, counter.value);
              },
              onComplete: restore,
            });
          }
          const glow = root.querySelector('[data-evidence-glow]');
          if (glow) {
            gsap
              .timeline({ delay: 0.3 })
              .to(glow, { opacity: 1, duration: 0.5, ease: 'power2.out' })
              .to(glow, { opacity: 0, duration: 0.9, ease: 'power2.in' });
          }
        });
        ScrollTrigger.create({ trigger: root, start: 'top 85%', once: true, onEnter: play });
        return restore;
      });
    },
    { scope: ref, dependencies: [runCount, tone], revertOnUpdate: true },
  );

  return (
    <div ref={ref} className="relative">
      {children}
      {verified ? (
        <div
          data-evidence-glow
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-lg opacity-0 shadow-[0_0_32px] shadow-verified/40 ring-2 ring-verified"
        />
      ) : null}
    </div>
  );
}
