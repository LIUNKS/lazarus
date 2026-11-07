'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import type { RefObject } from 'react';
import { createReveal, type RevealOptions } from './reveal';

gsap.registerPlugin(useGSAP);

/**
 * Reveals every element inside `scope` that matches `selector`.
 * The timeline is scoped to the container and reverted on unmount. With prefers-reduced-motion: reduce
 * nothing is animated, so the server-rendered final state stays as it is.
 */
export function useReveal(scope: RefObject<HTMLElement | null>, selector: string, options?: RevealOptions): void {
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        createReveal(selector, options);
      });
      return () => media.revert();
    },
    { scope },
  );
}