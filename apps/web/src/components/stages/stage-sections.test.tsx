import fc from 'fast-check';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { buildScannerView, countSourceLines } from '@/lib/stages/scanner-view';
import type { CorpseDetail, Reincarnation, SeanceSpec } from '@/lib/data/types';
import type { StageAccess } from '@/lib/stages/controls';
import {
  CORPSE_ID,
  SCRIPT_ESCAPED,
  SCRIPT_TEXT,
  corpseDetail,
  curseRow,
  cursesArbitrary,
  reincarnation,
  reincarnationArbitrary,
  seanceArbitrary,
  seanceSpec,
  viewerOf,
} from '@/lib/testing/stage-fixtures';

// A client component reads the router while it renders, and the approval form imports a Server Action.
// Neither matters for static markup, so both modules are replaced.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }), redirect: () => undefined }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
// The data load is replaced, so a test can make it succeed or fail without a database.
const stages = vi.hoisted(() => ({ load: async (): Promise<unknown> => ({ seance: null, reincarnation: null }) }));
vi.mock('@/lib/data/load-stages', () => ({ loadStages: () => stages.load() }));
// The execution decision reads the kill switch from the environment, which the test guards forbid. It is replaced too.
const execution = vi.hoisted(() => ({ enabled: true, sampleEnabled: true }));
vi.mock('@/lib/verification/execution', () => ({
  effectiveExecution: () => ({ enabled: execution.enabled }),
  effectiveSampleExecution: () => ({ enabled: execution.sampleEnabled }),
}));

const { StageOverviewView, StageSectionsView, StageSections } = await import('./stage-sections');

function render(
  access: StageAccess,
  data: {
    corpse?: CorpseDetail;
    seance?: SeanceSpec | null;
    reincarnation?: Reincarnation | null;
    liveVerificationEnabled?: boolean;
  } = {},
): string {
  const corpse = data.corpse ?? corpseDetail({ isSample: access !== 'owner', userId: access === 'owner' ? 'owner' : null });
  // The page renders the stepper above the source and the sections below it; the helper joins them in that order.
  return renderToStaticMarkup(
    <>
      <StageOverviewView
        corpse={corpse}
        seance={data.seance ?? null}
        reincarnation={data.reincarnation ?? null}
        liveVerificationEnabled={data.liveVerificationEnabled ?? true}
      />
      <StageSectionsView
        corpse={corpse}
        access={access}
        seance={data.seance ?? null}
        reincarnation={data.reincarnation ?? null}
        scannerView={buildScannerView(corpse.curses, countSourceLines(corpse.originalCode))}
        liveVerificationEnabled={data.liveVerificationEnabled ?? true}
      />
    </>,
  );
}

const FORBIDDEN_FOR_READERS = ['<button', '<form', '/api/', 'Verify live', 'data-stage-actions'];
const unapproved = seanceSpec({ approvedAt: null });

describe('R1 stage sections and overview', () => {
  const html = render('owner');

  it('R1.1 renders the three sections in order, each labeled by its heading', () => {
    const order = ['id="hex-scanner"', 'id="seance-chamber"', 'id="laboratory"'].map((marker) => html.indexOf(marker));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('aria-labelledby="hex-scanner-heading"');
    expect(html).toContain('<h2 id="hex-scanner-heading"');
    expect(html).toContain('<h2 id="seance-chamber-heading"');
    expect(html).toContain('<h2 id="laboratory-heading"');
  });

  it('R1.2 does not render the "Next stages" placeholder', () => {
    expect(html).not.toContain('Next stages');
    expect(html).not.toContain('Coming soon');
  });

  it('R1.3 R1.4 renders a labeled nav with one link per section and its state in words', () => {
    expect(html).toContain('<nav aria-label="Resurrection stages">');
    expect(html).toContain('href="#hex-scanner"');
    expect(html).toContain('href="#seance-chamber"');
    expect(html).toContain('href="#laboratory"');
    expect(html).toContain('1 curse stored');
    expect(html).toContain('Not started');
  });

  it('R1.5 puts the sections and the overview in the server-rendered HTML in their final state', () => {
    expect(html).toContain('Hex Scanner');
    expect(html).toContain('Séance Chamber');
    expect(html).toContain('Laboratory');
  });

  it('R1.4 shows the Laboratory state from the stored verification state', () => {
    const verified = render('visitor', { seance: seanceSpec(), reincarnation: reincarnation() });
    expect(verified).toContain('Approved');
    expect(verified).toMatch(/Laboratory<\/span><span class="block text-sm[^"]*">Verified</);
  });
});

describe('R7 Visitor and member-viewer markup has no controls', () => {
  it('R7.1 R7.2 R14.1 contains no button, form, API path, "Verify live", or stage-actions marker, and shows stored text as characters', () => {
    // Feature: 06-resurrection-ui, Property 9: Visitor markup has no controls
    // A Visitor never gets a control. A Member on a sample gets none while sample runs are off (see R18.13 below).
    fc.assert(
      fc.property(
        fc.constantFrom<StageAccess>('visitor', 'member-viewer'),
        fc.boolean(),
        seanceArbitrary,
        reincarnationArbitrary,
        cursesArbitrary,
        (access, liveOn, seance, stored, curses) => {
          const corpse = corpseDetail({ isSample: true, userId: null, curses, curseCount: curses.length });
          const liveVerificationEnabled = access === 'visitor' ? liveOn : false;
          const html = render(access, { corpse, seance, reincarnation: stored, liveVerificationEnabled });
          return FORBIDDEN_FOR_READERS.every((marker) => !html.includes(marker)) && !html.includes('<script');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('R18.13 gives a Member on a sample one "Verify live" button with the sample help text, and nothing else', () => {
    // Feature: 06-resurrection-ui, Property 9: Visitor markup has no controls
    fc.assert(
      fc.property(seanceArbitrary, reincarnationArbitrary, cursesArbitrary, (seance, stored, curses) => {
        const corpse = corpseDetail({ isSample: true, userId: null, curses, curseCount: curses.length });
        const html = render('member-viewer', { corpse, seance, reincarnation: stored, liveVerificationEnabled: true });
        if (stored === null) return FORBIDDEN_FOR_READERS.every((marker) => !html.includes(marker));
        return (
          (html.match(/<button/g) ?? []).length === 1 &&
          html.includes('>Verify live<') &&
          html.includes('The result is shown here and is not stored.') &&
          !html.includes('<form') &&
          !html.includes('/api/') &&
          !html.includes('Begin séance') &&
          !html.includes('Begin reincarnation') &&
          !html.includes('Approve spec') &&
          !html.includes('<script')
        );
      }),
      { numRuns: 100 },
    );
  });

  it('R7.1 gives a Visitor no control for a sample with every stage stored', () => {
    const html = render('visitor', { seance: seanceSpec(), reincarnation: reincarnation({ pbtPassed: null, totalRuns: null }) });
    for (const marker of FORBIDDEN_FOR_READERS) expect(html).not.toContain(marker);
  });

  it('R18.13 keeps the precomputed evidence of a sample visible next to the live button', () => {
    const html = render('member-viewer', { seance: seanceSpec(), reincarnation: reincarnation() });
    expect(html).toContain('Verified behavioral equivalence across 1,000 generated inputs.');
    expect(html).toContain('>Verify live<');
    expect(html).not.toContain('isolated environment');
  });

  it('R7.3 shows a Visitor a read-only notice with a sign-in link back to this corpse', () => {
    const html = render('visitor');
    expect(html).toContain('These results are precomputed and read-only.');
    expect(html).toContain(`href="/sign-in?next=${encodeURIComponent(`/corpses/${CORPSE_ID}`)}"`);
  });

  it('R7.4 shows a member-viewer a read-only notice without a sign-in link', () => {
    const html = render('member-viewer');
    expect(html).toContain('Sample results are precomputed and read-only.');
    expect(html).not.toContain('/sign-in');
  });

  it('R7.5 gives a sample with nothing stored the empty texts and the migration hint', () => {
    const html = render('visitor', { corpse: corpseDetail({ isSample: true, userId: null, curses: [], curseCount: 0 }) });
    expect(html).toContain('No curses are stored for this corpse.');
    expect(html).toContain('No séance is stored for this corpse.');
    expect(html).toContain('No reincarnation is stored for this corpse.');
    expect(html.match(/pnpm db:migrate/g)).toHaveLength(3);
  });
});

describe('R8 owner controls by stored state', () => {
  it('R8.2 R8.3 offers scan and the séance for a new corpse, and tells the owner to run the séance first', () => {
    const html = render('owner');
    expect(html).toContain('data-stage-actions');
    expect(html).toContain('>Scan again<');
    expect(html).toContain('>Begin séance<');
    expect(html).toContain('Runs the deterministic scanner. No model request.');
    expect(html).toContain('Uses the language model. Counts toward your hourly request limit.');
    expect(html).toContain('Run the séance first.');
    expect(html).not.toContain('Approve spec');
    expect(html).not.toContain('Begin reincarnation');
    expect(html).not.toContain('Verify live');
  });

  it('R8.2 labels the scan "Run scan" when no curse is stored', () => {
    const html = render('owner', { corpse: corpseDetail({ curses: [], curseCount: 0 }) });
    expect(html).toContain('>Run scan<');
    expect(html).toContain('No curses are stored for this corpse.');
    expect(html).toContain('Run the scan to look for curses.');
  });

  it('R8.4 R8.5 offers the approval for an unapproved séance and holds the reincarnation back with its reason', () => {
    const html = render('owner', { seance: unapproved });
    expect(html).toContain('Approve spec');
    expect(html).toContain('Not approved yet');
    expect(html).toContain('Approve the séance spec to enable reincarnation.');
    expect(html).not.toContain('>Begin séance<');
    expect(html).not.toContain('Begin reincarnation');
  });

  it('R8.5 offers the reincarnation for an approved séance without a reincarnation', () => {
    const html = render('owner', { seance: seanceSpec() });
    expect(html).toContain('>Begin reincarnation<');
    expect(html).toContain('Approved on 2026-01-02');
    expect(html).not.toContain('Approve spec');
    expect(html).not.toContain('Approve the séance spec');
  });

  it('R8.7 offers no regeneration once a reincarnation exists', () => {
    const html = render('owner', { seance: seanceSpec(), reincarnation: reincarnation() });
    expect(html).not.toContain('>Begin séance<');
    expect(html).not.toContain('>Begin reincarnation<');
    expect(html).not.toContain('Approve spec');
  });

  it('R8.8 R8.9 offers "Verify live" with its note only for a reincarnation that is not verified yet', () => {
    const html = render('owner', { seance: seanceSpec(), reincarnation: reincarnation({ pbtPassed: null, totalRuns: null, executionTimeMs: null }) });
    expect(html).toContain('>Verify live<');
    expect(html).toContain('counts toward a separate verification limit.');
    expect(html).toContain('Not verified yet.');
    expect(html).not.toContain('No property-based test result is stored for this module.');
  });

  it('R8.9 R18.10 shows no "Verify live" control while live verification is off, and tells the owner why', () => {
    const html = render('owner', {
      seance: seanceSpec(),
      reincarnation: reincarnation({ pbtPassed: null, totalRuns: null, executionTimeMs: null }),
      liveVerificationEnabled: false,
    });
    expect(html).not.toContain('Verify live');
    expect(html).not.toContain('counts toward a separate verification limit.');
    expect(html).toContain('Live verification is not available on this server.');
    expect(html).toContain('Not verified yet.');
    // The reincarnation itself is still shown.
    expect(html).toContain('Resurrected TypeScript');
  });

  it('R8.9 keeps a final verification result visible with live verification off, and adds no reason', () => {
    const html = render('owner', { seance: seanceSpec(), reincarnation: reincarnation(), liveVerificationEnabled: false });
    expect(html).toContain('Verified behavioral equivalence across 1,000 generated inputs.');
    expect(html).not.toContain('Live verification is not available on this server.');
  });
});

describe('R2.8 R15.3 loading the stage data', () => {
  const corpse = corpseDetail({ isSample: true, userId: null });
  const scannerView = buildScannerView(corpse.curses, countSourceLines(corpse.originalCode));

  it('R15.3 shows the generic error state in place of the sections when the load fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stages.load = async () => {
      throw new Error('permission denied for table seance_specs (42501)');
    };
    const html = renderToStaticMarkup(await StageSections({ corpse, viewer: null, scannerView }));
    expect(html).toContain('Something went wrong');
    expect(html).toContain('We could not load the stage results.');
    expect(html).not.toContain('id="hex-scanner"');
    expect(html).not.toContain('id="laboratory"');
    spy.mockRestore();
  });

  it('R2.8 R14.4 logs the failure on the server and shows no database text in the browser', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stages.load = async () => {
      throw new Error('permission denied for table seance_specs (42501)');
    };
    const html = renderToStaticMarkup(await StageSections({ corpse, viewer: null, scannerView }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(html).not.toMatch(/permission denied|seance_specs|42501/);
    // The log line names the kind of failure and carries no database text either.
    expect(String(spy.mock.calls[0]?.[0])).not.toMatch(/permission denied|seance_specs|42501/);
    spy.mockRestore();
  });

  it('R2.8 keeps the legacy source and the header out of this component, so they still render on a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stages.load = async () => {
      throw new Error('boom');
    };
    const html = renderToStaticMarkup(await StageSections({ corpse, viewer: null, scannerView }));
    // The component replaces only the stages. The page renders the header and the source before it.
    expect(html).not.toContain(corpse.title);
    expect(html).not.toContain('Legacy source');
  });

  it('R7.6 R2.1 resolves the access from the viewer and the corpse, never from a client value', async () => {
    stages.load = async () => ({ seance: seanceSpec({ approvedAt: null }), reincarnation: null });
    const own = corpseDetail({ isSample: false, userId: 'member-1' });
    const view = buildScannerView(own.curses, countSourceLines(own.originalCode));
    const asOwner = renderToStaticMarkup(await StageSections({ corpse: own, viewer: viewerOf('member-1'), scannerView: view }));
    const asOther = renderToStaticMarkup(await StageSections({ corpse: own, viewer: viewerOf('member-2'), scannerView: view }));
    const asVisitor = renderToStaticMarkup(await StageSections({ corpse: own, viewer: null, scannerView: view }));
    expect(asOwner).toContain('data-stage-actions');
    expect(asOther).not.toContain('data-stage-actions');
    expect(asVisitor).not.toContain('data-stage-actions');
    expect(asOther).toContain('Sample results are precomputed and read-only.');
    expect(asVisitor).toContain('/sign-in?next=');
  });

  it('R8.9 offers "Verify live" to the owner only while the server execution decision is enabled', async () => {
    const own = corpseDetail({ isSample: false, userId: 'member-1' });
    const view = buildScannerView(own.curses, countSourceLines(own.originalCode));
    stages.load = async () => ({ seance: seanceSpec(), reincarnation: reincarnation({ pbtPassed: null, totalRuns: null, executionTimeMs: null }) });
    try {
      execution.enabled = true;
      const on = renderToStaticMarkup(await StageSections({ corpse: own, viewer: viewerOf('member-1'), scannerView: view }));
      execution.enabled = false;
      const off = renderToStaticMarkup(await StageSections({ corpse: own, viewer: viewerOf('member-1'), scannerView: view }));
      expect(on).toContain('>Verify live<');
      expect(off).not.toContain('Verify live');
      expect(off).toContain('Live verification is not available on this server.');
    } finally {
      execution.enabled = true;
    }
  });

  it('R18.13 offers a Member the sample run from the kill switch decision only, and never a Visitor', async () => {
    const sample = corpseDetail({ isSample: true, userId: null });
    const view = buildScannerView(sample.curses, countSourceLines(sample.originalCode));
    stages.load = async () => ({ seance: seanceSpec(), reincarnation: reincarnation() });
    try {
      // The flag for imported code is off, and the sample still gets its button.
      execution.enabled = false;
      execution.sampleEnabled = true;
      const member = renderToStaticMarkup(await StageSections({ corpse: sample, viewer: viewerOf('member-1'), scannerView: view }));
      const visitor = renderToStaticMarkup(await StageSections({ corpse: sample, viewer: null, scannerView: view }));
      execution.sampleEnabled = false;
      const killed = renderToStaticMarkup(await StageSections({ corpse: sample, viewer: viewerOf('member-1'), scannerView: view }));
      expect(member).toContain('>Verify live<');
      expect(visitor).not.toContain('Verify live');
      expect(killed).not.toContain('Verify live');
    } finally {
      execution.enabled = true;
      execution.sampleEnabled = true;
    }
  });

  it('R2.7 renders the stages that the load returned', async () => {
    stages.load = async () => ({ seance: seanceSpec(), reincarnation: reincarnation() });
    const html = renderToStaticMarkup(await StageSections({ corpse, viewer: null, scannerView }));
    expect(html).toContain('Verified behavioral equivalence across 1,000 generated inputs.');
    expect(html).toContain('Approved on 2026-01-02');
  });
});

describe('R6 R14.1 stored values are text', () => {
  it('R3.7 R14.1 shows markup in a curse as characters', () => {
    const html = render('visitor', { corpse: corpseDetail({ isSample: true, userId: null, curses: [curseRow({ description: SCRIPT_TEXT, exorcismStrategy: SCRIPT_TEXT })] }) });
    expect(html).toContain(SCRIPT_ESCAPED);
    expect(html).not.toContain('<script>');
  });

  it('R4.7 R14.1 shows markup in the séance and in the code as characters', () => {
    const html = render('visitor', {
      seance: seanceSpec({ requirementsMd: `1. ${SCRIPT_TEXT}`, designMd: SCRIPT_TEXT, invariants: { entryFunction: 'f', input: SCRIPT_TEXT, output: 'o', invariants: [SCRIPT_TEXT] } }),
      reincarnation: reincarnation({ modernCode: SCRIPT_TEXT, pbtTestCode: SCRIPT_TEXT, targetStack: SCRIPT_TEXT }),
    });
    expect(html.split(SCRIPT_ESCAPED).length - 1).toBeGreaterThanOrEqual(7);
    expect(html).not.toContain('<script>');
  });
});
