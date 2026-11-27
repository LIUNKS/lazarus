'use client';

import { useRef } from 'react';
import { gsap, useGSAP } from './gsap';
import { MOTION_QUERY } from './motion-math';

// Runes and alchemical signs, not letters: the decoding reads as a curse lifting.
const GLYPHS = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ☉☽♁♄♃♂';

/**
 * A page title that decodes once from scrambled characters on first load (09-motion-ux Requirement 8). The server renders
 * the plain text, the accessible name stays the text through `aria-label` while it changes, and the heading always ends
 * with exactly `text`.
 */
export function ScrambleHeading({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);

  useGSAP(
    () => {
      const heading = ref.current;
      if (!heading) return;
      const restore = () => {
        heading.textContent = text;
        heading.removeAttribute('aria-label');
      };
      const media = gsap.matchMedia();
      media.add(MOTION_QUERY, () => {
        heading.setAttribute('aria-label', text);
        gsap.to(heading, {
          duration: 1.1,
          ease: 'none',
          scrambleText: { text, chars: GLYPHS, revealDelay: 0.25, speed: 0.5 },
          onComplete: restore,
        });
        return restore;
      });
      return () => media.revert();
    },
    { scope: ref, dependencies: [text], revertOnUpdate: true },
  );

  return (
    <h1 ref={ref} className={className}>
      {text}
    </h1>
  );
}
