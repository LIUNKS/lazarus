'use client';

import gsap from 'gsap';

/** Reveal_Timeline: only opacity and transform (y) are animated. */
export const REVEAL_FROM = { opacity: 0, y: 12 } as const;

export interface RevealOptions {
  duration?: number;
  stagger?: number;
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