import fc from 'fast-check';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Reincarnation } from '@/lib/data/types';
import type { StageAccess } from '@/lib/stages/controls';
import { CORPSE_ID, controlsFor, reincarnation, seanceSpec, SCRIPT_ESCAPED, SCRIPT_TEXT } from '@/lib/testing/stage-fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const { LaboratoryPanel } = await import('./laboratory-panel');

const NOT_RUN = { pbtPassed: null, totalRuns: null, executionTimeMs: null } as const;
const VERIFIED = { pbtPassed: true, totalRuns: 1000, executionTimeMs: 842 } as const;
const FAILED = { pbtPassed: false, totalRuns: 37, executionTimeMs: 12 } as const;
const INCOMPLETE = { pbtPassed: true, totalRuns: null, executionTimeMs: null } as const;

/**
 * `live` is the server decision for this corpse. It is off by default here, so a member-viewer gets no control; the
 * R18.13 tests switch it on for a sample.
 */
function render(access: StageAccess, stored: Reincarnation | null, live = access === 'owner'): string {
  return renderToStaticMarkup(
    <LaboratoryPanel
      reincarnation={stored}
      access={access}
      controls={controlsFor(access, seanceSpec(), stored, { liveVerificationEnabled: live })}
      corpseId={CORPSE_ID}
      currentPath={`/corpses/${CORPSE_ID}`}
    />,
  );
}

const count = (html: string, text: string) => html.split(text).length - 1;

describe('R16.11 R18.1 a Visitor and a member-viewer have no Verify_Control', () => {
  it.each(['visitor', 'member-viewer'] as const)('R18.1 %s markup for a NOT_RUN reincarnation has no button, marker, or /api/verify path', (access) => {
    const html = render(access, reincarnation(NOT_RUN));
    expect(html).not.toContain('Verify live');
    expect(html).not.toContain('data-stage-actions');
    expect(html).not.toContain('/api/verify');
    expect(html).not.toContain('<button');
    expect(html).toContain('Not verified yet.');
  });

  it('R7.1 R7.2 R18.1 never contains the control for any generated reincarnation that is not verified yet', () => {
    // Feature: 06-resurrection-ui, Property 9: Visitor markup has no controls
    fc.assert(
      fc.property(
        fc.constantFrom<StageAccess>('visitor', 'member-viewer'),
        fc.string({ maxLength: 20 }).filter((text) => !text.includes('/api/') && !text.includes('Verify live')),
        fc.oneof(fc.constant(null), fc.integer({ min: -2, max: 3000 })),
        (access, stack, runs) => {
          const html = render(access, reincarnation({ ...NOT_RUN, totalRuns: runs, targetStack: stack }));
          return !html.includes('Verify live') && !html.includes('data-stage-actions') && !html.includes('/api/') && !html.includes('<button');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('R18.1 shows a Visitor the precomputed evidence of a sample and no control', () => {
    const html = render('visitor', reincarnation(VERIFIED));
    expect(html).toContain('Verified behavioral equivalence across 1,000 generated inputs.');
    expect(html).not.toContain('data-stage-actions');
    expect(html).not.toContain('<button');
  });
});

describe('R18.13 a Member on a sample gets a live run while sample runs are on', () => {
  it.each([
    ['VERIFIED', VERIFIED],
    ['FAILED', FAILED],
    ['NOT_RUN', NOT_RUN],
    ['INCOMPLETE', INCOMPLETE],
  ])('R18.13 offers one "Verify live" button with the sample help text for a %s sample', (_state, fields) => {
    const html = render('member-viewer', reincarnation(fields), true);
    expect(count(html, 'data-stage-actions')).toBe(1);
    expect(count(html, '<button')).toBe(1);
    expect(html).toContain('>Verify live<');
    expect(html).toContain('The result is shown here and is not stored.');
    expect(html).not.toContain('isolated environment');
  });

  it('R18.13 R6.5 keeps the stored-result sentence of a NOT_RUN sample, because a live run stores nothing', () => {
    expect(render('member-viewer', reincarnation(NOT_RUN), true)).toContain('No property-based test result is stored for this module.');
  });

  it('R18.13 never offers the live run to a Visitor, even with sample runs on', () => {
    const html = render('visitor', reincarnation(VERIFIED), true);
    expect(html).not.toContain('data-stage-actions');
    expect(html).not.toContain('<button');
  });
});

describe('R18.1 R18.2 R6.5 the owner sees the Verify_Control only for a reincarnation that is not verified yet', () => {
  it('R18.2 R6.5 shows the button and its note directly below "Not verified yet."', () => {
    const html = render('owner', reincarnation(NOT_RUN));
    const evidence = html.indexOf('Not verified yet.');
    const button = html.indexOf('>Verify live<');
    const stack = html.indexOf('Target stack:');
    expect(evidence).toBeGreaterThan(-1);
    expect(button).toBeGreaterThan(evidence);
    expect(stack).toBeGreaterThan(button);
    expect(html).toContain(
      'Runs the legacy and the modern function in an isolated environment on generated inputs. This can take up to a minute and counts toward a separate verification limit.',
    );
  });

  it('R6.5 leaves out the "No property-based test result is stored" sentence when the control is shown', () => {
    expect(render('owner', reincarnation(NOT_RUN))).not.toContain('No property-based test result is stored for this module.');
  });

  it.each([
    ['VERIFIED', VERIFIED],
    ['FAILED', FAILED],
    ['INCOMPLETE', INCOMPLETE],
  ])('R18.2 offers no "Verify live" button for a %s reincarnation', (_state, fields) => {
    const html = render('owner', reincarnation(fields));
    expect(html).not.toContain('Verify live');
    expect(html).not.toContain('<button');
  });

  it('R18.9 keeps the verify instance mounted for an owner with a reincarnation, in every state, so its message can stay', () => {
    // One instance for the reincarnation control and one for the verification, at fixed places.
    for (const fields of [NOT_RUN, VERIFIED, FAILED, INCOMPLETE]) {
      expect(count(render('owner', reincarnation(fields)), 'data-stage-actions')).toBe(2);
    }
  });

  it('R18.1 gives an owner without a reincarnation the reincarnation control only, and no verify instance', () => {
    const html = render('owner', null);
    expect(count(html, 'data-stage-actions')).toBe(1);
    expect(html).not.toContain('Verify live');
    expect(html).toContain('No reincarnation is stored for this corpse.');
  });
});

describe('R6 the evidence block per state', () => {
  it('R6.2 R6.3 VERIFIED shows the exact run count, the empirical note, and the duration', () => {
    const html = render('visitor', reincarnation(VERIFIED));
    expect(html).toContain('Verified behavioral equivalence across 1,000 generated inputs.');
    expect(html).toContain('This is empirical evidence from randomly generated inputs. Other inputs were not checked.');
    expect(html).toContain('Completed in 842 ms.');
    expect(html).toContain('border-verified');
  });

  it('R6.4 FAILED shows the difference and the number of inputs, in the curse tone', () => {
    const html = render('visitor', reincarnation(FAILED));
    expect(html).toContain('The modern function differed from the legacy function.');
    expect(html).toContain('The check stopped after 37 generated inputs.');
    expect(html).toContain('border-curse');
    expect(html).not.toContain('Verified behavioral equivalence');
  });

  it('R6.5 NOT_RUN shows the stored-result sentence for a reader, in the neutral tone', () => {
    const html = render('member-viewer', reincarnation(NOT_RUN));
    expect(html).toContain('Not verified yet.');
    expect(html).toContain('No property-based test result is stored for this module.');
    expect(html).not.toContain('border-verified');
  });

  it('R6.6 INCOMPLETE shows no evidence', () => {
    const html = render('visitor', reincarnation(INCOMPLETE));
    expect(html).toContain('A passing result is stored without a run count, so no evidence is shown.');
    expect(html).not.toContain('Verified behavioral equivalence');
    expect(html).not.toContain('border-verified');
  });

  it('R6.7 R13.4 writes the state as text, so color is never the only signal', () => {
    expect(render('visitor', reincarnation(VERIFIED))).toContain('>Verified</p>');
    expect(render('visitor', reincarnation(FAILED))).toContain('>Failed</p>');
    expect(render('visitor', reincarnation(NOT_RUN))).toContain('>Not verified yet</p>');
    expect(render('visitor', reincarnation(INCOMPLETE))).toContain('>Incomplete</p>');
  });
});

describe('R5 the code views', () => {
  const html = render('visitor', reincarnation(VERIFIED));

  it('R5.1 shows the resurrected TypeScript with line numbers from 1, then the test, with distinct labels', () => {
    expect(html).toContain('aria-label="Resurrected TypeScript"');
    expect(html).toContain('aria-label="Property-based test"');
    expect(html).toContain('id="modern-line-1"');
    expect(html.indexOf('Resurrected TypeScript')).toBeLessThan(html.indexOf('Property-based test'));
  });

  it('R5.2 puts the test code in a disclosure that is collapsed by default and present in the HTML', () => {
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Property-based test<\/summary>/);
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).toContain('id="pbt-line-1"');
    expect(html).toContain('assertEquivalent(n)');
  });

  it('R5.3 shows the target stack and the UTC creation date', () => {
    expect(html).toContain('Target stack: TypeScript 6 (strict mode, ES2022).');
    expect(html).toContain('<time dateTime="2026-01-02T03:04:05+00:00">2026-01-02</time>');
  });

  it('R5.6 gives every code view of the page a distinct accessible name and every element a distinct id', () => {
    const labels = [...html.matchAll(/aria-label="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(labels).size).toBe(labels.length);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('R5.4 R14.1 renders code as text and keeps whitespace', () => {
    const shown = render('visitor', reincarnation({ modernCode: `${SCRIPT_TEXT}\n  indented`, pbtTestCode: SCRIPT_TEXT }));
    expect(shown).toContain(SCRIPT_ESCAPED);
    expect(shown).not.toContain('<script>');
    expect(shown).toContain('whitespace-pre');
  });

  it('R5.5 shows the empty text, with the reason for an owner who cannot reincarnate yet', () => {
    const empty = renderToStaticMarkup(
      <LaboratoryPanel
        reincarnation={null}
        access="owner"
        controls={controlsFor('owner', null, null)}
        corpseId={CORPSE_ID}
        currentPath={`/corpses/${CORPSE_ID}`}
      />,
    );
    expect(empty).toContain('No reincarnation is stored for this corpse.');
    expect(empty).toContain('Run the séance first.');
  });
});
