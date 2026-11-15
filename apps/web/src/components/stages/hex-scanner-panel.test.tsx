import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CurseRow } from '@/lib/data/types';
import type { StageAccess } from '@/lib/stages/controls';
import { buildScannerView } from '@/lib/stages/scanner-view';
import { CORPSE_ID, SCRIPT_ESCAPED, SCRIPT_TEXT, controlsFor, curseRow } from '@/lib/testing/stage-fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const { HexScannerPanel } = await import('./hex-scanner-panel');

function render(access: StageAccess, curses: CurseRow[], lineCount = 10): string {
  return renderToStaticMarkup(
    <HexScannerPanel
      view={buildScannerView(curses, lineCount)}
      access={access}
      controls={controlsFor(access, null, null)}
      corpseId={CORPSE_ID}
      currentPath={`/corpses/${CORPSE_ID}`}
    />,
  );
}

const CURSES = [
  curseRow({ id: 'a', curseType: 'EVAL_INJECTION', severity: 'FATAL', lineNumber: 7, description: 'eval runs text as code.', exorcismStrategy: 'Parse the data instead.' }),
  curseRow({ id: 'b', curseType: 'VAR_HOISTING', severity: 'HEX', lineNumber: 2 }),
  curseRow({ id: 'c', curseType: 'GLOBAL_POLLUTION', severity: 'BLOOD_CURSE', lineNumber: 2 }),
];

describe('R3 Hex Scanner panel', () => {
  const html = render('visitor', CURSES);

  it('R3.1 lists the curses by line number and then by curse type', () => {
    const order = ['Global pollution', 'Var hoisting', 'Eval injection'].map((label) => html.indexOf(`<span class="font-medium">${label}</span>`));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('R3.2 shows the type, the severity as text in the curse token, the line, the description, and the strategy', () => {
    expect(html).toContain('>Eval injection<');
    expect(html).toMatch(/<span[^>]*bg-curse text-curse-foreground[^>]*>FATAL<\/span>/);
    expect(html).toMatch(/<span[^>]*bg-curse text-curse-foreground[^>]*>BLOOD CURSE<\/span>/);
    expect(html).toContain('Line 7');
    expect(html).toContain('eval runs text as code.');
    expect(html).toContain('Exorcism strategy: </span>Parse the data instead.');
  });

  it('R3.3 links "Line N" to the same line of the source view when the line exists', () => {
    expect(html).toMatch(/<a href="#source-line-7"[^>]*>Line 7<\/a>/);
    expect(html).toMatch(/<a href="#source-line-2"[^>]*>Line 2<\/a>/);
  });

  it('R3.3 leaves "Line N" as plain text when the line is outside the source', () => {
    const outside = render('visitor', [curseRow({ lineNumber: 99 })], 10);
    expect(outside).toContain('Line 99');
    expect(outside).not.toContain('href="#source-line-99"');
  });

  it('R3.4 shows the total and the counts per severity and per type', () => {
    expect(html).toContain('3 curses stored.');
    expect(html).toContain('FATAL: 1');
    expect(html).toContain('BLOOD CURSE: 1');
    expect(html).toContain('HEX: 1');
    expect(html).toContain('Eval injection: 1');
    expect(html).toContain('Global pollution: 1');
  });

  it('R3.6 shows the empty text, with the scan hint for the owner and the migration hint for everyone else', () => {
    expect(render('owner', [])).toContain('Run the scan to look for curses.');
    expect(render('owner', [])).not.toContain('pnpm db:migrate');
    for (const access of ['visitor', 'member-viewer'] as const) {
      const empty = render(access, []);
      expect(empty).toContain('No curses are stored for this corpse.');
      expect(empty).toContain('pnpm db:migrate');
      expect(empty).not.toContain('Run the scan');
    }
  });

  it('R3.7 R14.1 shows markup in the type description and strategy as characters', () => {
    const shown = render('visitor', [curseRow({ description: SCRIPT_TEXT, exorcismStrategy: SCRIPT_TEXT })]);
    expect(shown).toContain(SCRIPT_ESCAPED);
    expect(shown).not.toContain('<script>');
  });

  it('R7.1 gives a Visitor and a member-viewer no scan control', () => {
    for (const access of ['visitor', 'member-viewer'] as const) {
      const shown = render(access, CURSES);
      expect(shown).not.toContain('data-stage-actions');
      expect(shown).not.toContain('<button');
    }
  });

  it('R8.2 gives the owner the scan control in every state, labeled by what is stored', () => {
    expect(render('owner', CURSES)).toContain('>Scan again<');
    expect(render('owner', [])).toContain('>Run scan<');
    expect(render('owner', CURSES)).toContain('Runs the deterministic scanner. No model request.');
  });
});
