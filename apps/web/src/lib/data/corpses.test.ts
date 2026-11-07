import { describe, expect, it, vi } from 'vitest';
import {
  countOwnedCorpses,
  deleteCorpseById,
  findOwnedCorpseIdByHash,
  getCorpse,
  insertCorpse,
  listOwnedCorpses,
  listSampleCorpses,
} from './corpses';
import { fakeClient } from '@/lib/testing/fake-client';
import { DataError, parseSummary } from './types';

const ROW = {
  id: '3f6c1b2e-7a4d-4e8b-9c15-2d0a8b6f4e73',
  title: 'Invoice totals',
  source_language: 'es3',
  status: 'RESURRECTED',
  created_at: '2026-01-02T03:04:05+00:00',
  is_sample: true,
  curses: [{ count: 4 }],
};

describe('R9 data layer: summaries', () => {
  it('maps a row and the embedded curse count', () => {
    expect(parseSummary(ROW)).toEqual({
      id: ROW.id,
      title: 'Invoice totals',
      sourceLanguage: 'es3',
      status: 'RESURRECTED',
      createdAt: ROW.created_at,
      isSample: true,
      curseCount: 4,
    });
  });

  it('counts zero when there are no curses', () => {
    expect(parseSummary({ ...ROW, curses: [] }).curseCount).toBe(0);
  });

  it.each([
    ['unknown status', { ...ROW, status: 'DEAD' }],
    ['unknown language', { ...ROW, source_language: 'python2' }],
    ['missing title', { ...ROW, title: undefined }],
    ['bad count', { ...ROW, curses: [{ count: 'x' }] }],
    ['not an object', 'text'],
  ])('rejects a row with %s', (_label, row) => {
    expect(() => parseSummary(row)).toThrow(DataError);
  });

  it('lists samples with one query ordered by title', async () => {
    const { client, calls } = fakeClient({ data: [ROW] });
    const items = await listSampleCorpses(client);
    expect(items).toHaveLength(1);
    expect(calls.filter(([m]) => m === 'from')).toHaveLength(1);
    expect(calls).toContainEqual(['eq', ['is_sample', true]]);
    expect(calls).toContainEqual(['order', ['title', { ascending: true }]]);
    expect(calls.find(([m]) => m === 'select')?.[1][0]).toContain('curses(count)');
  });

  it('lists owned corpses with page ranges and the exact total', async () => {
    const { client, calls } = fakeClient({ data: [ROW], count: 120 });
    const result = await listOwnedCorpses(client, 'member-id', { page: 3, pageSize: 50 });
    expect(result.total).toBe(120);
    expect(calls).toContainEqual(['range', [100, 149]]);
    expect(calls).toContainEqual(['eq', ['user_id', 'member-id']]);
    expect(calls).toContainEqual(['order', ['created_at', { ascending: false }]]);
  });

  it('throws a generic DataError and never carries database text', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { client } = fakeClient({ error: { code: '42501', message: 'permission denied for table corpses' } });
    const failure = await listSampleCorpses(client).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DataError);
    expect((failure as Error).message).not.toContain('permission denied');
    expect((failure as Error).message).not.toContain('42501');
    spy.mockRestore();
  });
});

describe('R10 data layer: detail and writes', () => {
  const DETAIL = {
    ...ROW,
    user_id: null,
    repo_url: 'https://example.test/repo',
    original_code: 'function f() {}\n',
    curses: [{ id: 'c1', curse_type: 'VAR_HOISTING', severity: 'HEX', line_number: 3 }],
  };

  it('maps a detail row and derives the curse count from the list', async () => {
    const { client, calls } = fakeClient({ data: DETAIL });
    const detail = await getCorpse(client, ROW.id);
    expect(detail?.curseCount).toBe(1);
    expect(detail?.curses).toEqual([{ id: 'c1', curseType: 'VAR_HOISTING', severity: 'HEX', lineNumber: 3 }]);
    expect(detail?.originalCode).toBe('function f() {}\n');
    expect(calls).toContainEqual(['order', ['line_number', { referencedTable: 'curses', ascending: true }]]);
  });

  it('returns null when no row is visible', async () => {
    const { client } = fakeClient({ data: null });
    expect(await getCorpse(client, ROW.id)).toBeNull();
  });

  it('counts owned corpses with a head request', async () => {
    const { client, calls } = fakeClient({ count: 7 });
    expect(await countOwnedCorpses(client, 'member-id')).toBe(7);
    expect(calls.find(([m]) => m === 'select')?.[1]).toEqual(['id', { count: 'exact', head: true }]);
  });

  it('finds an existing corpse by hash', async () => {
    expect(await findOwnedCorpseIdByHash(fakeClient({ data: { id: 'abc' } }).client, 'm', 'h')).toBe('abc');
    expect(await findOwnedCorpseIdByHash(fakeClient({ data: null }).client, 'm', 'h')).toBeNull();
  });

  it('inserts with is_sample false, the member id, and status INFECTED', async () => {
    const { client, calls } = fakeClient({ data: { id: 'new-id' } });
    const id = await insertCorpse(client, {
      memberId: 'member-id',
      title: 'T',
      sourceLanguage: 'es5-jquery',
      originalCode: 'x',
      codeHash: 'h',
      repoUrl: null,
    });
    expect(id).toBe('new-id');
    const [, [payload]] = calls.find(([m]) => m === 'insert') as [string, [Record<string, unknown>]];
    expect(payload).toMatchObject({ user_id: 'member-id', is_sample: false, status: 'INFECTED', source_language: 'es5-jquery' });
  });

  it('reports whether a delete removed a row', async () => {
    expect(await deleteCorpseById(fakeClient({ data: [{ id: 'x' }] }).client, 'x')).toBe(true);
    expect(await deleteCorpseById(fakeClient({ data: [] }).client, 'x')).toBe(false);
  });
});