import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatRunCount } from '@/lib/stages/format';
import {
  countFrame,
  crossingTime,
  hashTarget,
  shouldGlide,
  sweepDuration,
  SWEEP_MAX_SECONDS,
  SWEEP_MIN_SECONDS,
  type ClickLike,
} from './motion-math';

const SRC = path.resolve(import.meta.dirname, '..');
const ANIMATIONS = import.meta.dirname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('R2 scan beam timing', () => {
  it('R2.4 keeps the sweep duration within 1.2 and 3.2 seconds and never shorter for more lines', () => {
    // Feature: 09-motion-ux, Property 1: Sweep duration range and order
    fc.assert(
      fc.property(fc.integer({ min: -10, max: 100_000 }), fc.integer({ min: -10, max: 100_000 }), (a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        const d = sweepDuration(low);
        return d >= SWEEP_MIN_SECONDS && d <= SWEEP_MAX_SECONDS && d <= sweepDuration(high);
      }),
      { numRuns: 200 },
    );
  });

  it('R2.4 grows with short sources and gives the minimum for a count that is not finite', () => {
    expect(sweepDuration(10)).toBeLessThan(sweepDuration(40));
    expect(sweepDuration(Number.NaN)).toBe(SWEEP_MIN_SECONDS);
    expect(sweepDuration(Number.POSITIVE_INFINITY)).toBe(SWEEP_MIN_SECONDS);
  });

  it('R2.5 keeps the crossing time within 0 and the duration and in line order', () => {
    // Feature: 09-motion-ux, Property 2: Crossing time range and order
    const geometry = fc.record({
      viewHeight: fc.double({ min: 1, max: 20_000, noNaN: true }),
      beamHeight: fc.double({ min: 0, max: 200, noNaN: true }),
      duration: fc.double({ min: 0.1, max: 5, noNaN: true }),
    });
    fc.assert(
      fc.property(geometry, fc.double({ min: -500, max: 25_000, noNaN: true }), fc.double({ min: -500, max: 25_000, noNaN: true }), (g, a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        const t = crossingTime({ ...g, center: low });
        return t >= 0 && t <= g.duration && t <= crossingTime({ ...g, center: high });
      }),
      { numRuns: 200 },
    );
  });

  it('R2.5 meets the middle of the view halfway through and gives 0 for invalid geometry', () => {
    expect(crossingTime({ center: 450, viewHeight: 900, beamHeight: 64, duration: 2 })).toBeCloseTo(1, 10);
    expect(crossingTime({ center: 10, viewHeight: 0, beamHeight: 0, duration: 2 })).toBe(0);
    expect(crossingTime({ center: Number.NaN, viewHeight: 900, beamHeight: 64, duration: 2 })).toBe(0);
  });
});

describe('R3 line links', () => {
  it('R3.5 glides only for a plain primary click that nothing else prevented', () => {
    // Feature: 09-motion-ux, Property 4: Only plain primary clicks glide
    const click = fc.record<ClickLike>({
      button: fc.integer({ min: 0, max: 4 }),
      metaKey: fc.boolean(),
      ctrlKey: fc.boolean(),
      shiftKey: fc.boolean(),
      altKey: fc.boolean(),
      defaultPrevented: fc.boolean(),
    });
    fc.assert(
      fc.property(click, (event) => {
        const plain = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.defaultPrevented;
        return shouldGlide(event) === plain;
      }),
      { numRuns: 200 },
    );
  });

  it('R3.1 R3.5 reads the id of an in-page link and nothing else', () => {
    expect(hashTarget('#source-line-7')).toBe('source-line-7');
    expect(hashTarget('#hex-scanner')).toBe('hex-scanner');
    expect(hashTarget('#s%C3%A9ance')).toBe('séance');
    expect(hashTarget('#')).toBeNull();
    expect(hashTarget('/corpses/x#source-line-1')).toBeNull();
    expect(hashTarget('#%E0%A4%A')).toBeNull();
    expect(hashTarget(null)).toBeNull();
  });
});

describe('R5 run-count frames', () => {
  const EVIDENCE = 'Verified behavioral equivalence across 1,000 generated inputs.';

  it('R1.6 R5.2 R5.3 ends in the final text and changes nothing outside the first run count', () => {
    // Feature: 09-motion-ux, Property 3: Count frames end in the Final_State
    fc.assert(
      fc.property(
        fc.string({ maxLength: 30 }),
        fc.integer({ min: 1, max: 5_000_000 }),
        fc.string({ maxLength: 30 }),
        fc.double({ min: -10, max: 6_000_000, noNaN: true }),
        (before, target, after, current) => {
          const formatted = formatRunCount(target);
          const text = `${before}${formatted}${after}`;
          const index = text.indexOf(formatted);
          const frame = countFrame(text, target, current);
          const tail = text.slice(index + formatted.length);
          return (
            countFrame(text, target, target) === text &&
            frame.startsWith(text.slice(0, index)) &&
            frame.endsWith(tail) &&
            frame.length - text.slice(0, index).length - tail.length >= 1
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it('R5.3 returns a text without the run count unchanged', () => {
    // Feature: 09-motion-ux, Supporting check: no occurrence, no change
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), fc.integer({ min: 1, max: 5_000_000 }), fc.double({ noNaN: true }), (text, target, current) => {
        fc.pre(!text.includes(formatRunCount(target)));
        return countFrame(text, target, current) === text;
      }),
      { numRuns: 200 },
    );
  });

  it('R5.2 counts the evidence sentence with the thousands separator and keeps values within 0 and the target', () => {
    expect(countFrame(EVIDENCE, 1000, 37.4)).toBe('Verified behavioral equivalence across 37 generated inputs.');
    expect(countFrame(EVIDENCE, 1000, 0)).toBe('Verified behavioral equivalence across 0 generated inputs.');
    expect(countFrame(EVIDENCE, 1000, -5)).toBe('Verified behavioral equivalence across 0 generated inputs.');
    expect(countFrame(EVIDENCE, 1000, 2000)).toBe(EVIDENCE);
    expect(countFrame(EVIDENCE, 1000, Number.NaN)).toBe(EVIDENCE);
    expect(countFrame('1,000 of 1,000', 1000, 5)).toBe('5 of 1,000');
  });
});

describe('R1 motion rules (static checks)', () => {
  it('R1.2 imports GSAP plugins only in animations/gsap.ts', () => {
    for (const file of sourceFiles(SRC)) {
      const imports = readFileSync(file, 'utf8').match(/from\s*['"]gsap\/[^'"]+['"]/g) ?? [];
      if (path.relative(SRC, file) !== path.join('animations', 'gsap.ts')) expect(imports, path.relative(SRC, file)).toEqual([]);
    }
  });

  it('R1.2 imports gsap and @gsap/react directly only in animations/gsap.ts', () => {
    for (const file of sourceFiles(SRC)) {
      if (path.relative(SRC, file) === path.join('animations', 'gsap.ts')) continue;
      expect(readFileSync(file, 'utf8'), path.relative(SRC, file)).not.toMatch(/from\s*['"](?:gsap|@gsap\/react)['"]/);
    }
  });

  it('R1.3 R1.4 never binds a callback to the useGSAP context, which made a revert recurse until the stack overflowed', () => {
    for (const file of sourceFiles(ANIMATIONS)) {
      const source = readFileSync(file, 'utf8');
      // The callback parameters of useGSAP are (context, contextSafe); only withMotion in gsap.ts may use a contextSafe.
      if (path.basename(file) !== 'gsap.ts') expect(source, path.basename(file)).not.toMatch(/contextSafe/);
      // A component that starts animations from a ScrollTrigger or an event handler must do it through withMotion.
      if (/ScrollTrigger\.create|addEventListener\('click'/.test(source)) expect(source, path.basename(file)).toContain('withMotion(');
    }
  });

  it('R1.7 uses no raw hex color in any animation module', () => {
    for (const file of sourceFiles(ANIMATIONS)) expect(readFileSync(file, 'utf8'), path.basename(file)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
