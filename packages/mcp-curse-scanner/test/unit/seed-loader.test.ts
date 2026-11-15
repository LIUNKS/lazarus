import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CurseFinding, FunctionSignature } from '../../src/lib.ts';
import { describeEntryMismatch, describeMismatch } from '../support/seed-mismatch.ts';
import { loadSeedSamples, seededLineOf } from '../support/seed-loader.ts';

const PREFIX = 'Foundation_Spec prerequisite not met:';
const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function seedDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'seed-loader-'));
  created.push(dir);
  return dir;
}

const validSample = {
  sourceLanguage: 'es5-jquery',
  entryFunction: 'f',
  curses: [{ type: 'VAR_HOISTING', severity: 'HEX', match: 'var a' }],
};

function addSample(dir: string, folder: string, legacy: string | null, sample: unknown | null): void {
  mkdirSync(join(dir, folder));
  if (legacy !== null) writeFileSync(join(dir, folder, 'legacy.js'), legacy);
  if (sample !== null) {
    writeFileSync(join(dir, folder, 'sample.json'), typeof sample === 'string' ? sample : JSON.stringify(sample));
  }
}

const withCurse = (patch: object) => ({ ...validSample, curses: [{ ...validSample.curses[0], ...patch }] });

describe('seed loader', () => {
  it('R17.7 reports a missing seed directory and names the Foundation_Spec', () => {
    const load = loadSeedSamples(join(seedDir(), 'absent'));
    expect(load.samples).toEqual([]);
    expect(load.problems).toHaveLength(1);
    expect(load.problems[0]).toContain(PREFIX);
    expect(load.problems[0]).toContain('db/seed/');
    expect(load.problems[0]).toContain('01-lazarus-foundation');
  });

  it('R17.7 reports a seed directory without a Sample_Source subdirectory', () => {
    const dir = seedDir();
    writeFileSync(join(dir, 'generate-seed.ts'), '// not a sample');
    const load = loadSeedSamples(dir);
    expect(load.samples).toEqual([]);
    expect(load.problems[0]).toContain('contains no Sample_Source subdirectory');
  });

  it('R17.8 reports a missing legacy.js', () => {
    const dir = seedDir();
    addSample(dir, 'one', null, validSample);
    const load = loadSeedSamples(dir);
    expect(load.problems).toEqual([`${PREFIX} Sample_Source "one": db/seed/one/legacy.js is missing.`]);
  });

  it('R17.8 reports a missing sample.json', () => {
    const dir = seedDir();
    addSample(dir, 'one', 'var a;', null);
    const load = loadSeedSamples(dir);
    expect(load.problems).toEqual([`${PREFIX} Sample_Source "one": db/seed/one/sample.json is missing.`]);
  });

  it('R17.8 reports a sample.json that is not valid JSON', () => {
    const dir = seedDir();
    addSample(dir, 'one', 'var a;', '{ not json');
    const load = loadSeedSamples(dir);
    expect(load.samples).toEqual([]);
    expect(load.problems[0]).toContain(`Sample_Source "one": db/seed/one/sample.json is not valid JSON (`);
  });

  it.each([
    ['sourceLanguage', { ...validSample, sourceLanguage: 'es6' }],
    ['entryFunction', { ...validSample, entryFunction: '' }],
    ['curses', { ...validSample, curses: [] }],
    ['curses[0].type', withCurse({ type: 'NOT_A_CURSE' })],
    ['curses[0].severity', withCurse({ severity: 'MILD' })],
    ['curses[0].match', withCurse({ match: '' })],
  ])('R17.8 reports an invalid field: %s', (field, sample) => {
    const dir = seedDir();
    addSample(dir, 'one', 'var a;', sample);
    const load = loadSeedSamples(dir);
    expect(load.samples).toEqual([]);
    expect(load.problems).toHaveLength(1);
    expect(load.problems[0]).toMatch(
      new RegExp(`^${PREFIX} Sample_Source "one": sample\\.json field "${field.replace(/[[\]]/g, '\\$&')}" is missing or invalid \\(expected .+\\)\\.$`),
    );
  });

  it('R17.8 reports a match that does not occur in legacy.js', () => {
    const dir = seedDir();
    addSample(dir, 'one', 'function f() {}', validSample);
    const load = loadSeedSamples(dir);
    expect(load.samples).toEqual([]);
    expect(load.problems).toEqual([
      `${PREFIX} Sample_Source "one": curses[0].match "var a" does not occur in db/seed/one/legacy.js.`,
    ]);
  });

  it('R17.1 replaces CR LF by LF before computing the Seeded_Line', () => {
    const dir = seedDir();
    addSample(dir, 'one', 'function f() {}\r\n\r\nvar a = 1;\r\n', validSample);
    const load = loadSeedSamples(dir);
    expect(load.problems).toEqual([]);
    expect(load.samples[0]?.legacy).not.toContain('\r');
    expect(load.samples[0]?.curses[0]?.seededLine).toBe(3);
  });

  it('R17.1 uses the first line that contains the marker, 1-based', () => {
    expect(seededLineOf('a\nvar a\nvar a\n', 'var a')).toBe(2);
    expect(seededLineOf('var a', 'var a')).toBe(1);
    expect(seededLineOf('abc', 'zzz')).toBeNull();
  });

  it('R17.1 discovers only subdirectories, sorted by name, and ignores files such as generate-seed.ts', () => {
    const dir = seedDir();
    writeFileSync(join(dir, 'generate-seed.ts'), '// ignored');
    addSample(dir, 'b-sample', 'var a;', validSample);
    addSample(dir, 'a-sample', 'var a;', validSample);
    const load = loadSeedSamples(dir);
    expect(load.problems).toEqual([]);
    expect(load.samples.map((sample) => sample.folder)).toEqual(['a-sample', 'b-sample']);
  });

  it('R17.1 R17.8 keeps the valid samples when another sample has a problem', () => {
    const dir = seedDir();
    addSample(dir, 'good', 'var a;', validSample);
    addSample(dir, 'bad', 'var a;', '{');
    const load = loadSeedSamples(dir);
    expect(load.samples.map((sample) => sample.folder)).toEqual(['good']);
    expect(load.problems).toHaveLength(1);
  });

  it('R17.1 R17.2 loads the real db/seed/ without problems and finds the three samples', () => {
    const load = loadSeedSamples();
    expect(load.problems).toEqual([]);
    expect(load.samples.map((sample) => sample.folder)).toEqual(['batch-calculator', 'invoice-totals', 'query-string-parser']);
  });
});

describe('seed mismatch messages', () => {
  const curse = { type: 'CALLBACK_HELL', severity: 'BLOOD_CURSE', match: 'runJob(job3', seededLine: 37 } as const;
  const finding = (curseType: CurseFinding['curseType'], lineNumber: number): CurseFinding => ({
    curseType,
    severity: 'HEX',
    lineNumber,
    column: 1,
    description: 'd',
    exorcismStrategy: 's',
  });

  it('R17.9 names the folder, the Curse_Type, the Seeded_Line, the match text, and the returned lines', () => {
    const message = describeMismatch('batch-calculator', curse, [
      finding('CALLBACK_HELL', 33),
      finding('VAR_HOISTING', 2),
      finding('CALLBACK_HELL', 34),
    ]);
    expect(message).toBe(
      'Sample_Source "batch-calculator": CALLBACK_HELL expected at Seeded_Line 37 (match "runJob(job3") but the scanner returned CALLBACK_HELL at lines [33, 34]',
    );
  });

  it('R17.9 says none when the scanner returned no finding of that Curse_Type', () => {
    const message = describeMismatch('batch-calculator', curse, [finding('VAR_HOISTING', 2)]);
    expect(message).toContain('but the scanner returned none');
  });

  it('R17.9 names the folder, the function name, and the number of signatures for an Entry_Function', () => {
    const signature = (name: string | null): FunctionSignature => ({
      name,
      kind: 'declaration',
      params: [],
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      nestingDepth: 0,
      pureCandidate: true,
      impurityMarkers: [],
    });
    const message = describeEntryMismatch('invoice-totals', 'computeInvoiceTotal', [signature('round2'), signature(null)]);
    expect(message).toContain('Sample_Source "invoice-totals"');
    expect(message).toContain('"computeInvoiceTotal"');
    expect(message).toContain('returned 0 signatures');
  });
});
