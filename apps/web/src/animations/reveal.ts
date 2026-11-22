'use client';

import { gsap } from './gsap';

/** Reveal_Timeline: only opacity and transform (y) are animated. */
export const REVEAL_FROM = { opacity: 0, y: 12 } as const;

export interface RevealOptions {
  duration?: number;
  stagger?: number;
}

/**
 * The scroll variant (09-motion-ux Requirement 6): each element is revealed once, when its top edge enters the lower part
 * of the viewport, with the same values as the load variant. Elements already in view are revealed at once.
 */
export function createScrollReveal(selector: string, scope: Element, options: RevealOptions = {}): gsap.core.Tween[] {
  return gsap.utils.toArray<Element>(selector, scope).map((element) =>
    gsap.from(element, {
      ...REVEAL_FROM,
      duration: options.duration ?? 0.5,
      ease: 'power2.out',
      clearProps: 'opacity,transform',
      scrollTrigger: { trigger: element, start: 'top 92%', once: true },
    }),
  );
}

export function createReveal(targets: gsap.TweenTarget, options: RevealOptions = {}): gsap.core.Timeline {
  return gsap.timeline().from(targets, {
    ...REVEAL_FROM,
    duration: options.duration ?? 0.5,
    stagger: options.stagger ?? 0.06,
    ease: 'power2.out',
    clearProps: 'opacity,transform',
  });
}
