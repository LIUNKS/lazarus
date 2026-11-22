'use client';

// The only module that registers GSAP plugins (09-motion-ux Requirement 1.2). Every other Motion_Module imports gsap,
// useGSAP, and the plugins from here, so a plugin is registered exactly once and only in client code.
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { MOTION_QUERY } from './motion-math';

gsap.registerPlugin(useGSAP, ScrollTrigger, ScrollToPlugin, DrawSVGPlugin, ScrambleTextPlugin);

/** Wraps a function so that the animations it starts later belong to the motion context and are reverted with it. */
export type MotionSafe = <T extends (...args: never[]) => void>(func: T) => T;

/**
 * Runs `setup` only while MOTION_QUERY matches and returns the cleanup for `useGSAP`.
 *
 * Use the `safe` argument, never the `contextSafe` of `useGSAP`, for callbacks such as ScrollTrigger's `onEnter`. A
 * ScrollTrigger whose element is already in view calls `onEnter` synchronously, still inside this media context; a
 * function made safe by the outer `useGSAP` context would then register the two contexts inside each other, and the
 * next revert (React Strict Mode remounts every component in development) recurses until the stack overflows.
 */
export function withMotion(setup: (safe: MotionSafe) => void | (() => void)): () => void {
  const media = gsap.matchMedia();
  media.add(MOTION_QUERY, (_context, contextSafe) => {
    const safe: MotionSafe = (func) => (contextSafe ? (contextSafe(func) as typeof func) : func);
    return setup(safe);
  });
  return () => media.revert();
}

export { gsap, useGSAP, ScrollTrigger };
