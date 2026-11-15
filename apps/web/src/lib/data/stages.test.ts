import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeClient, writeCalls } from '@/lib/testing/fake-client';
import { approveSeanceSpec, getReincarnation, getSeanceSpec } from './stages';
import { DataError, parseInvariants, parseReincarnation, parseSeanceSpec } from './types';

const CORPSE_ID = '3f6c1b2e-7a4d-4e8b-9c15-2d0a8b6f4e73';

const INVARIANTS = {
  entry_function: 'computeInvoiceTotal',
  input: 'object { items: number[] }',
  output: 'object { total: number }',
  invariants: ['Every amount is rounded to two decimal places.', 'The total is never negative.'],
};

const SEANCE_ROW = {
  id: 'seance-1',
  requirements_md: '# Requirements\n1. THE function SHALL return a number.',
  design_md: '## Design\nUses `Math.round`.',
  invariants_json: INVARIANTS,
  approved_at: '2026-01-02T03:04:05+00:00',
};

const REINCARNATION_ROW = {
  id: 'reincarnation-1',
  target_stack: 'TypeScript 6 (strict mode, ES2022)',
  modern_code: 'export function f(): number { return 1; }',
  pbt_test_code: 'return fc.property(fc.integer(), () => true);',
  pbt_passed: true,
  total_runs: 1000,
  execution_time_ms: 842,
  created_at: '2026-01-02T03:04:05+00:00',
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('R2.5 parseInvariants', () => {
  it('accepts an object with exactly the four keys', () => {
    expect(parseInvariants(INVARIANTS)).toEqual({
      entryFunction: 'computeInvoiceTotal',
      input: 'object { items: number[] }',
      output: 'object { total: number }',
      invariants: ['Every amount is rounded to two decimal places.', 'The total is never negative.'],
    });
  });

  it('accepts an empty list of invariants', () => {
    expect(parseInvariants({ ...INVARIANTS, invariants: [] })?.invariants).toEqual([]);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'text'],
    ['a number', 7],
    ['an array', [INVARIANTS]],
    ['a missing key', { entry_function: 'f', input: 'i', output: 'o' }],
    ['an extra key', { ...INVARIANTS, extra: 'x' }],
    ['a renamed key', { entryFunction: 'f', input: 'i', output: 'o', invariants: [] }],
    ['an empty entry function', { ...INVARIANTS, entry_function: '' }],
    ['an empty input description', { ...INVARIANTS, input: '' }],
    ['an empty output description', { ...INVARIANTS, output: '' }],
    ['a numeric entry function', { ...INVARIANTS, entry_function: 5 }],
    ['invariants that are not an array', { ...INVARIANTS, invariants: 'one' }],
    ['a non-string invariant', { ...INVARIANTS, invariants: ['ok', 3] }],
  ])('rejects %s without throwing', (_label, value) => {
    expect(parseInvariants(value)).toBeNull();
  });

  it('R2.5 never throws and accepts only values with the exact shape', () => {
    // Feature: 06-resurrection-ui, Supporting check: parseInvariants is total
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const parsed = parseInvariants(value);
        if (parsed === null) return true;
        return parsed.entryFunction !== '' && parsed.input !== '' && parsed.output !== '' && Array.isArray(parsed.invariants);
      }),
      { numRuns: 200 },
    );
  });

  it('R2.5 accepts every generated document with the exact shape', () => {
    // Feature: 06-resurrection-ui, Supporting check: parseInvariants accepts valid documents
    const nonEmpty = fc.string({ minLength: 1 });
    fc.assert(
      fc.property(nonEmpty, nonEmpty, nonEmpty, fc.array(fc.string()), (entry, input, output, list) => {
        const parsed = parseInvariants({ entry_function: entry, input, output, invariants: list });
        return parsed !== null && parsed.entryFunction === entry && parsed.invariants.length === list.length;
      }),
      { numRuns: 200 },
    );
  });
});

describe('R2.3 and R2.6 parseSeanceSpec', () => {
  it('maps a row, the parsed invariants, and the approval time', () => {
    const spec = parseSeanceSpec(SEANCE_ROW);
    expect(spec).toMatchObject({
      id: 'seance-1',
      requirementsMd: SEANCE_ROW.requirements_md,
      designMd: SEANCE_ROW.design_md,
      approvedAt: '2026-01-02T03:04:05+00:00',
    });
    expect(spec.invariants?.entryFunction).toBe('computeInvoiceTotal');
  });

  it('maps a NULL approved_at to null', () => {
    expect(parseSeanceSpec({ ...SEANCE_ROW, approved_at: null }).approvedAt).toBeNull();
  });

  it('R2.5 keeps the row and sets the invariants to null when they are unreadable', () => {
    const spec = parseSeanceSpec({ ...SEANCE_ROW, invariants_json: { entry_function: 'f' } });
    expect(spec.invariants).toBeNull();
    expect(spec.requirementsMd).toBe(SEANCE_ROW.requirements_md);
  });

  it.each([
    ['not an object', 'text'],
    ['a missing id', { ...SEANCE_ROW, id: undefined }],
    ['numeric requirements', { ...SEANCE_ROW, requirements_md: 5 }],
    ['a NULL design', { ...SEANCE_ROW, design_md: null }],
    ['a numeric approval time', { ...SEANCE_ROW, approved_at: 12 }],
  ])('rejects a row with %s', (_label, row) => {
    expect(() => parseSeanceSpec(row)).toThrow(DataError);
  });
});

describe('R2.4 and R2.6 parseReincarnation', () => {
  it('maps a verified row', () => {
    expect(parseReincarnation(REINCARNATION_ROW)).toEqual({
      id: 'reincarnation-1',
      targetStack: 'TypeScript 6 (strict mode, ES2022)',
      modernCode: REINCARNATION_ROW.modern_code,
      pbtTestCode: REINCARNATION_ROW.pbt_test_code,
      pbtPassed: true,
      totalRuns: 1000,
      executionTimeMs: 842,
      createdAt: '2026-01-02T03:04:05+00:00',
    });
  });

  it('maps NULL verification columns to null, which is how a user reincarnation is first stored', () => {
    const row = parseReincarnation({ ...REINCARNATION_ROW, pbt_passed: null, total_runs: null, execution_time_ms: null });
    expect(row).toMatchObject({ pbtPassed: null, totalRuns: null, executionTimeMs: null });
  });

  it('keeps stored numbers as they are, even when they are not valid run counts', () => {
    expect(parseReincarnation({ ...REINCARNATION_ROW, total_runs: 0, execution_time_ms: -5 })).toMatchObject({
      totalRuns: 0,
      executionTimeMs: -5,
    });
  });

  it.each([
    ['not an object', 7],
    ['a missing modern code', { ...REINCARNATION_ROW, modern_code: undefined }],
    ['a NULL test code', { ...REINCARNATION_ROW, pbt_test_code: null }],
    ['a text pbt_passed', { ...REINCARNATION_ROW, pbt_passed: 'true' }],
    ['a text run count', { ...REINCARNATION_ROW, total_runs: '1000' }],
    ['a boolean duration', { ...REINCARNATION_ROW, execution_time_ms: true }],
    ['a numeric creation date', { ...REINCARNATION_ROW, created_at: 1 }],
  ])('rejects a row with %s', (_label, row) => {
    expect(() => parseReincarnation(row)).toThrow(DataError);
  });
});

describe('R2.3 getSeanceSpec', () => {
  it('queries the séance of the corpse with limit 1 and returns the parsed row', async () => {
    const { client, calls } = fakeClient({ data: SEANCE_ROW });
    const spec = await getSeanceSpec(client, CORPSE_ID);
    expect(spec?.id).toBe('seance-1');
    expect(calls).toContainEqual(['from', ['seance_specs']]);
    expect(calls).toContainEqual(['select', ['id,requirements_md,design_md,invariants_json,approved_at']]);
    expect(calls).toContainEqual(['eq', ['corpse_id', CORPSE_ID]]);
    expect(calls).toContainEqual(['limit', [1]]);
    expect(writeCalls(calls)).toEqual([]);
  });

  it('returns null when no row is visible', async () => {
    expect(await getSeanceSpec(fakeClient({ data: null }).client, CORPSE_ID)).toBeNull();
  });

  it('throws a generic DataError that carries no database text', async () => {
    const { client } = fakeClient({ error: { code: '42501', message: 'permission denied for table seance_specs' } });
    const failure = await getSeanceSpec(client, CORPSE_ID).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DataError);
    expect((failure as Error).message).not.toContain('permission denied');
    expect((failure as Error).message).not.toContain('42501');
  });

  it('throws a DataError for a row with an unexpected shape', async () => {
    await expect(getSeanceSpec(fakeClient({ data: { ...SEANCE_ROW, design_md: 4 } }).client, CORPSE_ID)).rejects.toBeInstanceOf(
      DataError,
    );
  });
});

describe('R2.4 getReincarnation', () => {
  it('queries the latest reincarnation of the corpse with limit 1', async () => {
    const { client, calls } = fakeClient({ data: REINCARNATION_ROW });
    const row = await getReincarnation(client, CORPSE_ID);
    expect(row?.id).toBe('reincarnation-1');
    expect(calls).toContainEqual(['from', ['reincarnations']]);
    expect(calls).toContainEqual([
      'select',
      ['id,target_stack,modern_code,pbt_test_code,pbt_passed,total_runs,execution_time_ms,created_at'],
    ]);
    expect(calls).toContainEqual(['eq', ['corpse_id', CORPSE_ID]]);
    expect(calls).toContainEqual(['order', ['created_at', { ascending: false }]]);
    expect(calls).toContainEqual(['limit', [1]]);
    expect(writeCalls(calls)).toEqual([]);
  });

  it('returns null when no row is visible', async () => {
    expect(await getReincarnation(fakeClient({ data: null }).client, CORPSE_ID)).toBeNull();
  });

  it('throws a generic DataError that carries no database text', async () => {
    const { client } = fakeClient({ error: { code: 'PGRST301', message: 'JWT expired for role authenticated' } });
    const failure = await getReincarnation(client, CORPSE_ID).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DataError);
    expect((failure as Error).message).not.toContain('JWT');
    expect((failure as Error).message).not.toContain('PGRST301');
  });
});

describe('R12.1 R12.2 approveSeanceSpec', () => {
  const NOW = '2026-02-03T04:05:06.000Z';

  it('issues one update that sets only approved_at, filtered by the corpse and a NULL approved_at', async () => {
    const { client, calls } = fakeClient({ data: [{ id: 'seance-1' }] });
    expect(await approveSeanceSpec(client, CORPSE_ID, NOW)).toBe(true);
    expect(writeCalls(calls)).toEqual([['update', [{ approved_at: NOW }]]]);
    expect(calls).toContainEqual(['from', ['seance_specs']]);
    expect(calls).toContainEqual(['eq', ['corpse_id', CORPSE_ID]]);
    expect(calls).toContainEqual(['is', ['approved_at', null]]);
    expect(calls).toContainEqual(['select', ['id']]);
  });

  it('returns false when no row changed', async () => {
    expect(await approveSeanceSpec(fakeClient({ data: [] }).client, CORPSE_ID, NOW)).toBe(false);
    expect(await approveSeanceSpec(fakeClient({ data: null }).client, CORPSE_ID, NOW)).toBe(false);
  });

  it('throws a generic DataError when the database rejects the update', async () => {
    const { client } = fakeClient({ error: { code: '42501', message: 'new row violates row-level security policy' } });
    const failure = await approveSeanceSpec(client, CORPSE_ID, NOW).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DataError);
    expect((failure as Error).message).not.toContain('row-level security');
  });
});

describe('R2.7 loadStages', () => {
  it('starts both stage reads before either one finishes, and makes no other query', async () => {
    const started: string[] = [];
    const finishedBeforeBothStarted: string[] = [];
    const client = {
      from: (table: string) => {
        started.push(table);
        const builder: unknown = new Proxy(
          {},
          {
            get(_target, property: string) {
              if (property === 'then') {
                return (resolve: (value: unknown) => unknown) =>
                  Promise.resolve().then(() => {
                    if (started.length < 2) finishedBeforeBothStarted.push(table);
                    resolve({ data: null, error: null });
                  });
              }
              return () => builder;
            },
          },
        );
        return builder;
      },
    };
    vi.resetModules();
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => client }));
    const { loadStages } = await import('./load-stages');
    await expect(loadStages(CORPSE_ID)).resolves.toEqual({ seance: null, reincarnation: null });
    expect([...started].sort()).toEqual(['reincarnations', 'seance_specs']);
    expect(finishedBeforeBothStarted).toEqual([]);
    vi.doUnmock('@/lib/supabase/server');
  });
});
