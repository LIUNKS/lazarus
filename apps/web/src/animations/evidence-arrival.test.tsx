import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VerificationEvidence } from '@/components/stages/verification-evidence';
import { buildVerificationView } from '@/lib/stages/verification';
import { EvidenceArrival } from './evidence-arrival';
import { Heartbeat } from './heartbeat';

const VERIFIED = buildVerificationView({ pbtPassed: true, totalRuns: 1000, executionTimeMs: 842 });
const FAILED = buildVerificationView({ pbtPassed: false, totalRuns: 37, executionTimeMs: 12 });

function arrive(view: typeof VERIFIED): string {
  return renderToStaticMarkup(
    <EvidenceArrival runCount={view.runCount} tone={view.tone}>
      <VerificationEvidence view={view} />
    </EvidenceArrival>,
  );
}

describe('R5 Evidence_Arrival markup', () => {
  it('R1.5 R5.1 renders the evidence block exactly as without the wrapper, with the full Evidence_Text', () => {
    const html = arrive(VERIFIED);
    expect(html).toContain(renderToStaticMarkup(<VerificationEvidence view={VERIFIED} />));
    expect(html).toContain('Verified behavioral equivalence across 1,000 generated inputs.');
  });

  it('R5.4 adds the emerald glow as hidden decoration for a verified result', () => {
    expect(arrive(VERIFIED)).toMatch(/<div data-evidence-glow="true" aria-hidden="true" class="pointer-events-none [^"]*opacity-0[^"]*ring-verified[^"]*"><\/div><\/div>$/);
  });

  it('R5.5 adds no glow for any other tone and leaves the block unchanged', () => {
    const html = arrive(FAILED);
    expect(html).not.toContain('data-evidence-glow');
    expect(html).toBe(`<div class="relative">${renderToStaticMarkup(<VerificationEvidence view={FAILED} />)}</div>`);
  });
});

describe('R4 Heartbeat markup', () => {
  const html = renderToStaticMarkup(<Heartbeat className="mt-2" />);

  it('R4.2 is hidden decoration drawn with currentColor and a muted token', () => {
    expect(html).toMatch(/^<svg aria-hidden="true" focusable="false" viewBox="0 0 70 28" class="[^"]*text-primary mt-2">/);
    expect(html).toContain('stroke="currentColor"');
  });

  it('R4.3 R4.4 shows the whole line with no text, count, or percentage in the server markup', () => {
    expect(html).not.toMatch(/stroke-dash/);
    expect(html.replace(/<[^>]*>/g, '')).toBe('');
  });
});
