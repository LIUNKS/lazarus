import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CurseRow } from '@/lib/data/types';
import { buildScannerView, countSourceLines, curseLabel } from './scanner-view';

const CURSE_TYPES = ['GLOBAL_POLLUTION', 'VAR_HOISTING', 'IMPLICIT_COERCION', 'CALLBACK_HELL', 'EVAL_INJECTION', 'PROTOTYPE_POLLUTION'];
const SEVERITIES = ['HEX', 'BLOOD_CURSE', 'FATAL'];

const curse = (overrides: Partial<CurseRow> = {}): CurseRow => ({
  id: 'c1',
  curseType: 'VAR_HOISTING',
  severity: 'HEX',
  lineNumber: 1,
  description: 'A description.',
  exorcismStrategy: 'A strategy.',
  ...overrides,
});

const curseArbitrary = fc.record({
  id: fc.uuid(),
  curseType: fc.constantFrom(...CURSE_TYPES),
  severity: fc.constantFrom(...SEVERITIES),
  lineNumber: fc.integer({ min: -3, max: 60 }),
  description: fc.string({ maxLength: 20 }),
  exorcismStrategy: fc.string({ maxLength: 20 }),
});

describe('R3 scanner view model', () => {
  it('R3.1 R3.3 R3.4 R3.5 sorts, counts, anchors, and marks lines for any list of curses and any source length', () => {
    // Feature: 06-resurrection-ui, Property 7: Scanner view
    fc.assert(
      fc.property(fc.array(curseArbitrary, { maxLength: 25 }), fc.integer({ min: 0, max: 50 }), (curses, lineCount) => {
        const view = buildScannerView(curses, lineCount);
        const inRange = (n: number) => n >= 1 && n <= lineCount;
        const sorted = view.entries.every((entry, index) => {
          const previous = view.entries[index - 1];
          if (previous === undefined) return true;
          const key = (e: typeof entry) => [e.lineNumber, e.curseType, e.id] as const;
          const [a, b] = [key(previous), key(entry)];
          return a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] <= b[2])));
        });
        const sum = (rows: Array<{ count: number }>) => rows.reduce((total, row) => total + row.count, 0);
        const expectedMarked = new Set(curses.filter((c) => inRange(c.lineNumber)).map((c) => c.lineNumber));
        const severityOrder = view.bySeverity.map((row) => row.severity);
        const rank = (s: string) => ['FATAL', 'BLOOD_CURSE', 'HEX'].indexOf(s);
        return (
          view.total === curses.length &&
          view.entries.length === curses.length &&
          sorted &&
          sum(view.bySeverity) === view.total &&
          sum(view.byType) === view.total &&
          view.bySeverity.every((row) => row.count > 0) &&
          view.byType.every((row) => row.count > 0) &&
          severityOrder.every((s, i) => i === 0 || rank(severityOrder[i - 1]!) < rank(s)) &&
          view.byType.every((row, i) => i === 0 || view.byType[i - 1]!.label <= row.label) &&
          view.entries.every((entry) => (entry.anchor !== null) === inRange(entry.lineNumber)) &&
          view.entries.every((entry) => entry.anchor === null || entry.anchor === `source-line-${entry.lineNumber}`) &&
          view.markedLines.size === expectedMarked.size &&
          [...expectedMarked].every((n) => view.markedLines.has(n))
        );
      }),
      { numRuns: 200 },
    );
  });

  it('R3.1 lists two curses on one line in curse-type order and marks the line once', () => {
    const view = buildScannerView(
      [curse({ id: 'b', curseType: 'VAR_HOISTING', lineNumber: 4 }), curse({ id: 'a', curseType: 'GLOBAL_POLLUTION', lineNumber: 4 })],
      10,
    );
    expect(view.entries.map((entry) => entry.curseType)).toEqual(['GLOBAL_POLLUTION', 'VAR_HOISTING']);
    expect([...view.markedLines]).toEqual([4]);
  });

  it.each([
    [0, 5],
    [-1, 5],
    [6, 5],
    [1.5, 5],
  ])('R3.3 R3.5 line %s of a %s-line source has no anchor and is not marked', (lineNumber, lineCount) => {
    const view = buildScannerView([curse({ lineNumber })], lineCount);
    expect(view.entries[0]?.anchor).toBeNull();
    expect(view.markedLines.size).toBe(0);
  });

  it.each([
    [1, 5],
    [5, 5],
  ])('R3.3 line %s of a %s-line source links to its line', (lineNumber, lineCount) => {
    expect(buildScannerView([curse({ lineNumber })], lineCount).entries[0]?.anchor).toBe(`source-line-${lineNumber}`);
  });

  it('R3.4 counts per severity from the most serious and per type alphabetically by label', () => {
    const view = buildScannerView(
      [
        curse({ id: '1', severity: 'HEX', curseType: 'VAR_HOISTING', lineNumber: 1 }),
        curse({ id: '2', severity: 'FATAL', curseType: 'EVAL_INJECTION', lineNumber: 2 }),
        curse({ id: '3', severity: 'HEX', curseType: 'VAR_HOISTING', lineNumber: 3 }),
        curse({ id: '4', severity: 'BLOOD_CURSE', curseType: 'CALLBACK_HELL', lineNumber: 4 }),
      ],
      10,
    );
    expect(view.total).toBe(4);
    expect(view.bySeverity).toEqual([
      { severity: 'FATAL', count: 1 },
      { severity: 'BLOOD_CURSE', count: 1 },
      { severity: 'HEX', count: 2 },
    ]);
    expect(view.byType).toEqual([
      { curseType: 'CALLBACK_HELL', label: 'Callback hell', count: 1 },
      { curseType: 'EVAL_INJECTION', label: 'Eval injection', count: 1 },
      { curseType: 'VAR_HOISTING', label: 'Var hoisting', count: 2 },
    ]);
  });

  it('R3.4 leaves out severities and types that do not occur', () => {
    const view = buildScannerView([curse({ severity: 'FATAL' })], 3);
    expect(view.bySeverity).toEqual([{ severity: 'FATAL', count: 1 }]);
    expect(view.byType).toHaveLength(1);
  });

  it('R3.6 gives an empty view for no curses', () => {
    const view = buildScannerView([], 12);
    expect(view).toMatchObject({ total: 0, bySeverity: [], byType: [], entries: [] });
    expect(view.markedLines.size).toBe(0);
  });

  it('R3.7 keeps description and strategy text exactly as stored', () => {
    const view = buildScannerView([curse({ description: '<b>bold</b> & "quoted"', exorcismStrategy: '<script>x()</script>' })], 3);
    expect(view.entries[0]).toMatchObject({ description: '<b>bold</b> & "quoted"', strategy: '<script>x()</script>' });
  });

  it('R3.4 keeps the counts equal to the total even for a severity outside the schema list', () => {
    const view = buildScannerView([curse({ id: '1', severity: 'HEX' }), curse({ id: '2', severity: 'ODD', lineNumber: 2 })], 5);
    expect(view.bySeverity).toEqual([
      { severity: 'HEX', count: 1 },
      { severity: 'ODD', count: 1 },
    ]);
  });
});

describe('R3.5 countSourceLines', () => {
  it.each([
    ['', 1],
    ['a', 1],
    ['a\n', 1],
    ['a\nb', 2],
    ['a\nb\n', 2],
    ['a\n\n', 2],
    ['\n', 1],
    ['\n\n', 2],
  ])('counts %j as %s line(s), the way the source view shows them', (code, expected) => {
    expect(countSourceLines(code)).toBe(expected);
  });
});

describe('R3.2 curseLabel', () => {
  it.each([
    ['GLOBAL_POLLUTION', 'Global pollution'],
    ['VAR_HOISTING', 'Var hoisting'],
    ['EVAL_INJECTION', 'Eval injection'],
    ['X', 'X'],
    ['', ''],
  ])('labels %j as %j', (type, label) => {
    expect(curseLabel(type)).toBe(label);
  });
});
