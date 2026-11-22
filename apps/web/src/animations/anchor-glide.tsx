'use client';

import { gsap, useGSAP, withMotion } from './gsap';
import { hashTarget, LINE_LINK_SELECTOR, shouldGlide } from './motion-math';

/** Keeps the target below the top edge; matches `scroll-mt-20` of the stage sections. */
const OFFSET_PX = 80;

/** Moves focus to the target without a second scroll. A target that is not focusable is focusable only while focused. */
function focusTarget(target: HTMLElement): void {
  if (!target.hasAttribute('tabindex')) {
    target.setAttribute('tabindex', '-1');
    target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
  }
  target.focus({ preventScroll: true });
}

/**
 * Smooth scrolling for the Line_Links (09-motion-ux Requirement 3): the "Line N" links of the Hex Scanner and the links
 * of the stage overview. It renders nothing and adds one click listener to the document. Any click it does not handle
 * (another link, a modified click, a missing target, reduced motion) keeps the native behavior.
 */
export function AnchorGlide() {
  useGSAP(() =>
    withMotion((safe) => {
      const highlight = safe((line: HTMLElement) => {
        gsap.fromTo(
          line,
          { opacity: 0.4, x: -8 },
          { opacity: 1, x: 0, duration: 0.6, ease: 'elastic.out(1, 0.5)', clearProps: 'opacity,transform' },
        );
      });
      const glide = safe((target: HTMLElement) => {
        gsap.to(window, {
          duration: 0.7,
          ease: 'power2.inOut',
          scrollTo: { y: target, offsetY: OFFSET_PX, autoKill: true },
          onComplete: () => {
            focusTarget(target);
            if (target.matches('li[id]')) highlight(target);
          },
        });
      });
      const onClick = (event: MouseEvent) => {
        if (!shouldGlide(event) || !(event.target instanceof Element)) return;
        const link = event.target.closest(LINE_LINK_SELECTOR);
        if (!(link instanceof HTMLAnchorElement)) return;
        const id = hashTarget(link.getAttribute('href'));
        const target = id === null ? null : document.getElementById(id);
        if (id === null || target === null) return;
        event.preventDefault();
        window.history.pushState(null, '', `#${encodeURIComponent(id)}`);
        glide(target);
      };
      document.addEventListener('click', onClick);
      return () => document.removeEventListener('click', onClick);
    }),
  );

  return null;
}
