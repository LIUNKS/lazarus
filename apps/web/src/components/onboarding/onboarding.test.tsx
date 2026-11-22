import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { containsForbiddenTerm } from '@/lib/stages/wording';

// The Server Action reads request headers; the markup only needs a function to pass as the form action.
vi.mock('@/app/sign-in/actions', () => ({ signInWithGitHub: async () => undefined }));

const { CapabilityList } = await import('./capability-list');
const { FirstSteps } = await import('./first-steps');
const { HowItWorks } = await import('./how-it-works');
const { SampleInvite } = await import('./sample-invite');
const { SignInInvite } = await import('./sign-in-invite');

const SRC = path.resolve(import.meta.dirname, '../..');
const OFF = { ownCode: false, samples: false };
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ');

describe('R2 How it works', () => {
  it('R2.1 lists the four stages in order', () => {
    const html = renderToStaticMarkup(<HowItWorks />);
    const order = ['The Morgue', 'Hex Scanner', 'Séance Chamber', 'Laboratory'].map((name) => html.indexOf(`>${name}<`));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.match(/<li /g)).toHaveLength(4);
  });
});

describe('R3 sign-in invite', () => {
  const html = renderToStaticMarkup(<SignInInvite live={OFF} />);

  it('R3.1 has a heading, the capabilities, a sign-in button back to /import, the trust line, and the usage note', () => {
    expect(html).toContain('Resurrect your own code');
    expect(html).toContain('aria-label="What you can do after signing in"');
    expect(html).toContain('<input type="hidden" name="next" value="/import"/>');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Sign in with GitHub<\/button>/);
    expect(html).toContain('no access to your repositories');
    expect(html).toContain('per hour');
  });

  it('R1.3 R3.1 shows no live verification item while the server runs none', () => {
    expect(html).not.toContain('>Verify<');
    expect(renderToStaticMarkup(<CapabilityList live={{ ownCode: false, samples: true }} />)).toContain('>Verify<');
  });

  it('R1.6 has no Forbidden_Term in the rendered text', () => {
    for (const markup of [html, renderToStaticMarkup(<HowItWorks />), renderToStaticMarkup(<FirstSteps />)]) {
      expect(containsForbiddenTerm(textOf(markup))).toBe(false);
    }
  });
});

describe('R4 sample invite', () => {
  it('R4.1 gives a Visitor a sign-in button back to /import and the trust line', () => {
    const html = renderToStaticMarkup(<SampleInvite signedIn={false} />);
    expect(html).toContain('Like what you saw?');
    expect(html).toContain('<input type="hidden" name="next" value="/import"/>');
    expect(html).toContain('no access to your repositories');
  });

  it('R4.2 gives a Member a link to /import and no form', () => {
    const html = renderToStaticMarkup(<SampleInvite signedIn />);
    expect(html).toContain('href="/import"');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<button');
  });

  it('R4.1 R4.3 is rendered by the corpse page for a sample only', () => {
    const page = readFileSync(path.join(SRC, 'app', 'corpses', '[id]', 'page.tsx'), 'utf8');
    expect(page).toContain('{corpse.isSample ? <SampleInvite signedIn={viewer !== null} /> : null}');
  });
});

describe('R5 R6 sign-in page and first steps', () => {
  it('R5.1 adds the capabilities and the trust line to the sign-in page and keeps its redirect', () => {
    const page = readFileSync(path.join(SRC, 'app', 'sign-in', 'page.tsx'), 'utf8');
    expect(page).toContain('<CapabilityList live={liveFlags()} />');
    expect(page).toContain('{TRUST_LINE}');
    expect(page).toContain('<input type="hidden" name="next" value={next} />');
  });

  it('R6.1 lists four steps, the source limit of the model stages, and a link to /import', () => {
    const html = renderToStaticMarkup(<FirstSteps />);
    expect(html.match(/<li>/g)).toHaveLength(4);
    expect(html).toContain('20,000 bytes');
    expect(html).toContain('href="/import"');
  });

  it('R3.1 R3.3 R6.1 the Morgue shows the invite to a Visitor only and the first steps in place of the bare empty state', () => {
    const page = readFileSync(path.join(SRC, 'app', '(morgue)', 'page.tsx'), 'utf8');
    expect(page).toContain('{!viewer ? <SignInInvite live={liveFlags()} /> : null}');
    expect(page).not.toContain('read-only mode');
    expect(page).toContain('<FirstSteps />');
    expect(page).toContain('<HowItWorks />');
  });
});
