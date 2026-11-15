import { describe, expect, it } from 'vitest';
import { fakeClient, type FakeCall, type FakeResult } from '@/lib/testing/fake-client';
import { StoreError } from './errors';
import { createSupabaseStore } from './store';
import type { NewSeance } from './types';

const SENTINEL = 'sentinel-database-message-5b1d';
const CORPSE_ID = '3f2b8c1e-6d4a-4f7b-9c21-0a5e8d7b1c34';

const corpseRow = {
  id: CORPSE_ID,
  user_id: 'user-1',
  is_sample: false,
  source_language: 'es5-jquery',
  original_code: 'function f() { return 1; }',
  code_hash: 'hash-1',
  status: 'INFECTED',
};
const seanceRow = {
  id: 's1',
  corpse_id: CORPSE_ID,
  requirements_md: 'req',
  design_md: 'des',
  invariants_json: { entry_function: 'f' },
  approved_at: null,
};
const reincarnationRow = {
  id: 'r1',
  corpse_id: CORPSE_ID,
  target_stack: 'TypeScript (strict, ES2022)',
  modern_code: 'export const f = 1;',
  pbt_test_code: 'return null;',
  pbt_passed: null,
  total_runs: null,
  execution_time_ms: null,
  created_at: '2026-11-10T10:00:00+00:00',
};

function setup(result: FakeResult | FakeResult[]) {
  const { client, calls } = fakeClient(result);
  return { store: createSupabaseStore(client), calls };
}
const methods = (calls: FakeCall[]) => calls.map(([method]) => method);
const argsOf = (calls: FakeCall[], method: string) => calls.filter(([name]) => name === method).map(([, args]) => args);

describe('R4 R7 reads (Requirements 4 and 7)', () => {
  it('R4.2 loads a corpse with one query of the listed columns and maps the row (Requirement 4)', async () => {
    const { store, calls } = setup({ data: corpseRow });
    expect(await store.loadCorpse(CORPSE_ID)).toEqual({
      id: CORPSE_ID,
      userId: 'user-1',
      isSample: false,
      sourceLanguage: 'es5-jquery',
      originalCode: 'function f() { return 1; }',
      codeHash: 'hash-1',
      status: 'INFECTED',
    });
    expect(calls).toEqual([
      ['from', ['corpses']],
      ['select', ['id,user_id,is_sample,source_language,original_code,code_hash,status']],
      ['eq', ['id', CORPSE_ID]],
      ['maybeSingle', []],
    ]);
  });

  it('R4.6 returns null for a missing row, and a sample row has no owner (Requirement 4)', async () => {
    expect(await setup({ data: null }).store.loadCorpse(CORPSE_ID)).toBeNull();
    const sample = await setup({ data: { ...corpseRow, user_id: null, is_sample: true } }).store.loadCorpse(CORPSE_ID);
    expect(sample).toMatchObject({ userId: null, isSample: true });
  });

  it('R7.1 reads a Seance spec and a reincarnation of one corpse with a single query each (Requirement 7)', async () => {
    const seance = setup({ data: seanceRow });
    expect(await seance.store.getSeance(CORPSE_ID)).toMatchObject({ id: 's1', corpseId: CORPSE_ID, approvedAt: null });
    expect(argsOf(seance.calls, 'eq')).toEqual([['corpse_id', CORPSE_ID]]);
    expect(argsOf(seance.calls, 'select')).toEqual([['id,corpse_id,requirements_md,design_md,invariants_json,approved_at']]);

    const reincarnation = setup({ data: reincarnationRow });
    expect(await reincarnation.store.getReincarnation(CORPSE_ID)).toMatchObject({ id: 'r1', pbtPassed: null, totalRuns: null });
    expect(argsOf(reincarnation.calls, 'select')).toEqual([['id,corpse_id,target_stack,modern_code,pbt_test_code,pbt_passed,total_runs,execution_time_ms,created_at']]);
  });

  it('R7.1 limits the hash lookup to 25 newest candidates and excludes the corpse itself (Requirement 7)', async () => {
    const { store, calls } = setup({ data: [{ id: 'c2', user_id: null, is_sample: true, created_at: '2026-11-01T00:00:00+00:00' }] });
    expect(await store.listHashMatches('hash-1', CORPSE_ID)).toEqual([{ corpseId: 'c2', userId: null, isSample: true, createdAt: '2026-11-01T00:00:00+00:00' }]);
    expect(argsOf(calls, 'eq')).toEqual([['code_hash', 'hash-1']]);
    expect(argsOf(calls, 'neq')).toEqual([['id', CORPSE_ID]]);
    expect(argsOf(calls, 'order')).toEqual([['created_at', { ascending: false }], ['id', { ascending: false }]]);
    expect(argsOf(calls, 'limit')).toEqual([[25]]);
  });

  it('R7.1 reads rows for a list of corpse ids and makes no query for an empty list (Requirement 7)', async () => {
    const empty = setup({ data: [] });
    expect(await empty.store.seancesFor([])).toEqual([]);
    expect(await empty.store.reincarnationsFor([])).toEqual([]);
    expect(empty.calls).toEqual([]);

    const reads = setup([{ data: [seanceRow] }, { data: [reincarnationRow] }]);
    expect(await reads.store.seancesFor(['a', 'b'])).toHaveLength(1);
    expect(await reads.store.reincarnationsFor(['a', 'b'])).toHaveLength(1);
    expect(argsOf(reads.calls, 'in')).toEqual([['corpse_id', ['a', 'b']], ['corpse_id', ['a', 'b']]]);
    expect(argsOf(reads.calls, 'order')).toEqual([['created_at', { ascending: false }]]);
  });

  it('R5.4 reads the curses of a corpse and maps the five fields (Requirement 5)', async () => {
    const { store } = setup({ data: [{ curse_type: 'VAR_HOISTING', severity: 'HEX', line_number: 4, description: 'd', exorcism_strategy: 's' }] });
    expect(await store.getCurses(CORPSE_ID)).toEqual([{ curseType: 'VAR_HOISTING', severity: 'HEX', lineNumber: 4, description: 'd', exorcismStrategy: 's' }]);
  });

  it('R7.7 throws a StoreError whose detail is the error code and never the database message (Requirement 7)', async () => {
    const { store } = setup({ data: null, error: { code: '42501', message: SENTINEL } });
    const error = await store.loadCorpse(CORPSE_ID).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StoreError);
    expect((error as StoreError).detail).toBe('42501');
    expect(`${(error as Error).message} ${(error as StoreError).detail} ${JSON.stringify(error)}`).not.toContain('sentinel');
  });

  it('R7.7 uses a constant detail when the error code is missing or unsafe, and throws for an unexpected row shape (Requirement 7)', async () => {
    for (const error of [{ message: SENTINEL }, { code: 'x'.repeat(40), message: SENTINEL }, { code: 'bad code!', message: SENTINEL }]) {
      const caught = await setup({ data: null, error }).store.getSeance(CORPSE_ID).catch((e: unknown) => e);
      expect((caught as StoreError).detail).toBe('db');
    }
    await expect(setup({ data: { ...corpseRow, status: 'UNKNOWN' } }).store.loadCorpse(CORPSE_ID)).rejects.toBeInstanceOf(StoreError);
    await expect(setup({ data: { ...seanceRow, requirements_md: 5 } }).store.getSeance(CORPSE_ID)).rejects.toBeInstanceOf(StoreError);
    await expect(setup({ data: 'not rows' }).store.getCurses(CORPSE_ID)).rejects.toBeInstanceOf(StoreError);
  });
});

describe('R11 R14 inserts (Requirements 11 and 14)', () => {
  it('R11.1 inserts a Seance spec with the whitelisted columns and a null approval (Requirement 11)', async () => {
    const { store, calls } = setup({ data: seanceRow });
    const invariantsJson = { entry_function: 'f', input: 'i', output: 'o', invariants: ['a', 'b', 'c'] };
    const result = await store.insertSeance({ corpseId: CORPSE_ID, requirementsMd: 'req', designMd: 'des', invariantsJson, approvedAt: null });
    expect(result.kind).toBe('inserted');
    expect(argsOf(calls, 'insert')).toEqual([
      [{ corpse_id: CORPSE_ID, requirements_md: 'req', design_md: 'des', invariants_json: invariantsJson, approved_at: null }],
    ]);
    expect(methods(calls)).toEqual(['from', 'insert', 'select', 'single']);
  });

  it('R14.1 inserts a reincarnation with the whitelisted columns (Requirement 14)', async () => {
    const { store, calls } = setup({ data: reincarnationRow });
    const result = await store.insertReincarnation({
      corpseId: CORPSE_ID,
      targetStack: 'TypeScript (strict, ES2022)',
      modernCode: 'export const f = 1;',
      pbtTestCode: 'return null;',
      pbtPassed: null,
      totalRuns: null,
      executionTimeMs: null,
    });
    expect(result.kind).toBe('inserted');
    expect(argsOf(calls, 'insert')).toEqual([
      [
        {
          corpse_id: CORPSE_ID,
          target_stack: 'TypeScript (strict, ES2022)',
          modern_code: 'export const f = 1;',
          pbt_test_code: 'return null;',
          pbt_passed: null,
          total_runs: null,
          execution_time_ms: null,
        },
      ],
    ]);
  });

  it('R11.2 R14.2 maps the unique violation 23505 to a conflict and any other error to a StoreError (Requirements 11 and 14)', async () => {
    const seance: NewSeance = { corpseId: CORPSE_ID, requirementsMd: 'r', designMd: 'd', invariantsJson: { entry_function: 'f', input: 'i', output: 'o', invariants: [] }, approvedAt: null };
    const reincarnation = { corpseId: CORPSE_ID, targetStack: 't', modernCode: 'm', pbtTestCode: 'p', pbtPassed: null, totalRuns: null, executionTimeMs: null };
    expect(await setup({ data: null, error: { code: '23505', message: SENTINEL } }).store.insertSeance(seance)).toEqual({ kind: 'conflict' });
    expect(await setup({ data: null, error: { code: '23505', message: SENTINEL } }).store.insertReincarnation(reincarnation)).toEqual({ kind: 'conflict' });
    for (const code of ['42501', '23503', 'PGRST116']) {
      const caught = await setup({ data: null, error: { code, message: SENTINEL } }).store.insertSeance(seance).catch((e: unknown) => e);
      expect(caught).toBeInstanceOf(StoreError);
      expect((caught as StoreError).detail).toBe(code);
    }
  });

  it('R11.7 R14.8 never issues an update or delete against seance_specs or reincarnations (Requirements 11 and 14)', async () => {
    const { store, calls } = setup([{ data: seanceRow }, { data: seanceRow }, { data: [seanceRow] }]);
    await store.getSeance(CORPSE_ID);
    await store.insertSeance({ corpseId: CORPSE_ID, requirementsMd: 'r', designMd: 'd', invariantsJson: { entry_function: 'f', input: 'i', output: 'o', invariants: [] }, approvedAt: null });
    await store.seancesFor(['a']);
    let table = '';
    for (const [method, args] of calls) {
      if (method === 'from') table = String(args[0]);
      if (['update', 'delete', 'upsert'].includes(method)) expect(['seance_specs', 'reincarnations']).not.toContain(table);
    }
  });
});

describe('R5 R11 R14 writes (Requirements 5, 11, and 14)', () => {
  it('R5.1 replaces curses through replace_corpse_curses with the five snake_case fields (Requirement 5)', async () => {
    const { store, calls } = setup({ data: 2 });
    await store.replaceCurses(CORPSE_ID, [
      { curseType: 'EVAL_INJECTION', severity: 'FATAL', lineNumber: 3, description: 'd', exorcismStrategy: 's' },
    ]);
    expect(calls).toEqual([
      [
        'rpc',
        [
          'replace_corpse_curses',
          { p_corpse_id: CORPSE_ID, p_curses: [{ curse_type: 'EVAL_INJECTION', severity: 'FATAL', line_number: 3, description: 'd', exorcism_strategy: 's' }] },
        ],
      ],
    ]);
  });

  it('R5.9 throws a StoreError when the replacement fails (Requirement 5)', async () => {
    const { store } = setup({ data: null, error: { code: '42501', message: SENTINEL } });
    await expect(store.replaceCurses(CORPSE_ID, [])).rejects.toMatchObject({ name: 'StoreError', detail: '42501' });
  });

  it('R11.4 R14.4 guards the status update so a late request cannot overwrite a newer status (Requirements 11 and 14)', async () => {
    const seance = setup({ data: [{ status: 'IN_SEANCE' }] });
    expect(await seance.store.setStatus(CORPSE_ID, { to: 'IN_SEANCE' })).toEqual({ updated: true, status: 'IN_SEANCE' });
    expect(argsOf(seance.calls, 'update')).toEqual([[{ status: 'IN_SEANCE' }]]);
    expect(argsOf(seance.calls, 'eq')).toEqual([['id', CORPSE_ID], ['status', 'INFECTED']]);

    const resurrect = setup({ data: [{ status: 'RESURRECTED' }] });
    expect(await resurrect.store.setStatus(CORPSE_ID, { to: 'RESURRECTED' })).toEqual({ updated: true, status: 'RESURRECTED' });
    expect(argsOf(resurrect.calls, 'update')).toEqual([[{ status: 'RESURRECTED' }]]);
    expect(argsOf(resurrect.calls, 'neq')).toEqual([['status', 'RESURRECTED']]);
  });

  it('R11.6 reports updated false when the guard matched no row, and throws a StoreError on a database error (Requirement 11)', async () => {
    expect(await setup({ data: [] }).store.setStatus(CORPSE_ID, { to: 'IN_SEANCE' })).toEqual({ updated: false });
    await expect(setup({ data: null, error: { code: '42501', message: SENTINEL } }).store.setStatus(CORPSE_ID, { to: 'IN_SEANCE' })).rejects.toBeInstanceOf(StoreError);
  });

  it('R8.1 reserves quota through the reserve_llm_call RPC of the same client (Requirement 8)', async () => {
    const { store, calls } = setup({ data: [{ allowed: true, denied_by: 'none', retry_after_seconds: 0 }] });
    expect(await store.reserveQuota('reincarnate')).toEqual({ allowed: true });
    expect(argsOf(calls, 'rpc')[0]?.[0]).toBe('reserve_llm_call');
  });
});
