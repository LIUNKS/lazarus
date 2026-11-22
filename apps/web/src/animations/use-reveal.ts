'use client';

import type { RefObject } from 'react';
import { gsap, useGSAP } from './gsap';
import { MOTION_QUERY } from './motion-math';
import { createReveal, createScrollReveal, type RevealOptions } from './reveal';

/** `load` reveals everything once on first load; `scroll` reveals each element when it scrolls into view. */
export type RevealTrigger = 'load' | 'scroll';

export interface UseRevealOptions extends RevealOptions {
  trigger?: RevealTrigger;
}

/**
 * Reveals every element inside `scope` that matches `selector`.
 * The timeline is scoped to the container and reverted on unmount. With prefers-reduced-motion: reduce
 * nothing is animated, so the server-rendered final state stays as it is.
 */
export function useReveal(scope: RefObject<HTMLElement | null>, selector: string, options: UseRevealOptions = {}): void {
  const { trigger = 'load', ...timing } = options;
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add(MOTION_QUERY, () => {
        if (trigger === 'scroll') {
          if (scope.current) createScrollReveal(selector, scope.current, timing);
        } else createReveal(selector, timing);
      });
      return () => media.revert();
    },
    { scope },
  );
}
