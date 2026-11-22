'use client';

import { useRef, type ReactNode } from 'react';
import { gsap, ScrollTrigger, useGSAP, withMotion } from './gsap';
import { crossingTime, sweepDuration } from './motion-math';

const DIMMED = 0.35;

/**
 * The Scan_Beam (09-motion-ux Requirement 2). It wraps the legacy source view and, the first time the view scrolls into
 * sight, moves a crimson band from top to bottom once. Each cursed line stays dimmed until the center of the band crosses
 * it, then returns to its final state with a short nudge. The beam is decoration: the source view and its markers are
 * rendered by the children exactly as without this wrapper.
 */
export function ScanBeam({
  children,
  markedLines,
  lineCount,
  idPrefix = 'source',
}: {
  children: ReactNode;
  /** The cursed line numbers. An array, because the prop crosses the server-to-client boundary. */
  markedLines: readonly number[];
  lineCount: number;
  idPrefix?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const root = ref.current;
      const beam = root?.querySelector<HTMLElement>('[data-scan-beam]');
      if (!root || !beam) return;
      return withMotion((safe) => {
        const play = safe(() => {
          const viewHeight = root.offsetHeight;
          const beamHeight = beam.offsetHeight;
          const duration = sweepDuration(lineCount);
          const lines = markedLines
            .map((number) => document.getElementById(`${idPrefix}-line-${number}`))
            .filter((line): line is HTMLElement => line !== null && root.contains(line));
          const timeline = gsap.timeline();
          if (lines.length > 0) timeline.set(lines, { opacity: DIMMED, immediateRender: false }, 0);
          timeline
            .set(beam, { opacity: 1, immediateRender: false }, 0)
            .fromTo(beam, { y: -beamHeight }, { y: viewHeight, duration, ease: 'none', immediateRender: false }, 0)
            .to(beam, { opacity: 0, duration: 0.25 }, duration);
          for (const line of lines) {
            const at = crossingTime({ center: line.offsetTop + line.offsetHeight / 2, viewHeight, beamHeight, duration });
            timeline.fromTo(
              line,
              { opacity: DIMMED, x: -6 },
              { opacity: 1, x: 0, duration: 0.45, ease: 'power2.out', immediateRender: false, clearProps: 'opacity,transform' },
              at,
            );
          }
        });
        ScrollTrigger.create({ trigger: root, start: 'top 75%', once: true, onEnter: play });
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className="relative">
      {children}
      {/* The clipping layer holds only the beam, so the focus outline of the source view is never cut off. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
        <div data-scan-beam className="absolute inset-x-0 top-0 h-16 bg-linear-to-b from-transparent via-curse/20 to-transparent opacity-0" />
      </div>
    </div>
  );
}
