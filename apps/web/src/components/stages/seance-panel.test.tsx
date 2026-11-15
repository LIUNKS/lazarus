import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SeanceSpec } from '@/lib/data/types';
import type { StageAccess } from '@/lib/stages/controls';
import { CORPSE_ID, SCRIPT_ESCAPED, SCRIPT_TEXT, controlsFor, seanceSpec } from '@/lib/testing/stage-fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }), redirect: () => undefined }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));

const { SeancePanel } = await import('./seance-panel');

function render(access: StageAccess, seance: SeanceSpec | null): string {
  return renderToStaticMarkup(
    <SeancePanel
      seance={seance}
      access={access}
      controls={controlsFor(access, seance, null)}
      corpseId={CORPSE_ID}
      currentPath={`/corpses/${CORPSE_ID}`}
    />,
  );
}

describe('R4 Séance panel', () => {
  const html = render('visitor', seanceSpec());

  it('R4.1 shows each criterion with its number and the EARS keywords in bold', () => {
    expect(html).toContain('<li value="1"><strong>THE</strong> function <strong>SHALL</strong> return a number.</li>');
    expect(html).toContain('<strong>WHEN</strong>');
    expect(html).toContain('<code class="rounded bg-muted px-1 font-mono text-[0.85em]">0</code>');
  });

  it('R4.2 shows the design with inline code spans and fenced code in monospaced elements', () => {
    expect(html).toContain('<code class="rounded bg-muted px-1 font-mono text-[0.85em]">Math.round</code>');
    expect(html).toContain('<pre');
    expect(html).toContain('const a = 1;');
  });

  it('R4.3 shows the entry function, the input, the output, and the invariants as a list', () => {
    expect(html).toContain('Entry function: </span><code');
    expect(html).toContain('>computeTotal</code>');
    expect(html).toContain('Input: </span>object { items: number[] }');
    expect(html).toContain('Output: </span>number');
    expect(html).toContain('<li>The result is never negative.</li>');
    expect(html).toContain('<li>The result is rounded to two decimals.</li>');
  });

  it('R4.4 shows the unreadable-invariants text and still shows the requirements and the design', () => {
    const shown = render('visitor', seanceSpec({ invariants: null }));
    expect(shown).toContain('The stored invariants could not be read.');
    expect(shown).toContain('<strong>SHALL</strong>');
    expect(shown).toContain('Math.round');
    expect(shown).not.toContain('Entry function');
  });

  it('R4.5 shows the UTC approval date, or "Not approved yet"', () => {
    expect(html).toContain('Approved on 2026-01-02');
    expect(render('visitor', seanceSpec({ approvedAt: null }))).toContain('Not approved yet');
  });

  it('R10.5 shows "Not approved yet" for a copy that the cache inserted without an approval', () => {
    const shown = render('owner', seanceSpec({ approvedAt: null }));
    expect(shown).toContain('Not approved yet');
    expect(shown).toContain('Approve spec');
  });

  it('R4.6 shows the empty text, with the start control for the owner and the migration hint for everyone else', () => {
    const owner = render('owner', null);
    expect(owner).toContain('No séance is stored for this corpse.');
    expect(owner).toContain('>Begin séance<');
    expect(owner).not.toContain('pnpm db:migrate');
    const visitor = render('visitor', null);
    expect(visitor).toContain('No séance is stored for this corpse.');
    expect(visitor).toContain('pnpm db:migrate');
    expect(visitor).not.toContain('<button');
  });

  it('R4.7 R14.1 shows markup in every stored field as characters', () => {
    const shown = render(
      'visitor',
      seanceSpec({ requirementsMd: `1. ${SCRIPT_TEXT}\n\`${SCRIPT_TEXT}\``, designMd: `# ${SCRIPT_TEXT}`, invariants: { entryFunction: SCRIPT_TEXT, input: SCRIPT_TEXT, output: SCRIPT_TEXT, invariants: [SCRIPT_TEXT] } }),
    );
    expect(shown).not.toContain('<script>');
    expect(shown.split(SCRIPT_ESCAPED).length - 1).toBeGreaterThanOrEqual(6);
  });

  it('R8.4 offers the approval form only to the owner, and only while the séance is not approved', () => {
    expect(render('owner', seanceSpec({ approvedAt: null }))).toContain('<input type="hidden" name="id"');
    expect(render('owner', seanceSpec())).not.toContain('Approve spec');
    for (const access of ['visitor', 'member-viewer'] as const) {
      expect(render(access, seanceSpec({ approvedAt: null }))).not.toContain('<form');
    }
  });

  it('R8.3 offers no start control once a séance is stored', () => {
    expect(render('owner', seanceSpec())).not.toContain('>Begin séance<');
  });
});
