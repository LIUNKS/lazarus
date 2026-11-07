import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeClient, writeCalls, type FakeResult } from '@/lib/testing/fake-client';

const MEMBER_ID = '3f6c1b2e-7a4d-4e8b-9c15-2d0a8b6f4e73';
const OTHER_ID = '9b2e4f61-3c7a-4d58-a1e0-6f8d2c5b7a94';

const state = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.client }));

const { importCorpse } = await import('@/app/import/actions');
const { initialImportState } = await import('@/app/import/import-state');
const { deleteCorpse } = await import('@/app/corpses/actions');
const { signOut } = await import('@/app/auth/actions');

const VISITOR = { data: null, error: null };
const MEMBER = { data: { claims: { sub: MEMBER_ID, email: 'm@example.test' } }, error: null };

function use(result: FakeResult | FakeResult[], claims: typeof VISITOR | typeof MEMBER) {
  const fake = fakeClient(result, claims);
  state.client = fake.client;
  return fake;
}

function importForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  const fields = { title: 'Legacy module', language: 'es5-jquery', pastedCode: 'var a = 1;\r\n', repoUrl: '', ...overrides };
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('R8 and R15 a Visitor can never write', () => {
  it('import redirects to sign-in and calls no write method', async () => {
    const { calls } = use({}, VISITOR);
    await expect(importCorpse(initialImportState, importForm())).rejects.toThrow('NEXT_REDIRECT:/sign-in?next=%2Fimport');
    expect(writeCalls(calls)).toEqual([]);
    expect(calls.filter(([m]) => m === 'from')).toEqual([]);
  });

  it('delete redirects to sign-in and calls no write method', async () => {
    const { calls } = use({}, VISITOR);
    const form = new FormData();
    form.set('id', OTHER_ID);
    await expect(deleteCorpse(form)).rejects.toThrow('NEXT_REDIRECT:/sign-in?next=%2Fcrypt');
    expect(writeCalls(calls)).toEqual([]);
  });

  it('sign-out redirects home and does not call signOut', async () => {
    const { calls } = use({}, VISITOR);
    await expect(signOut()).rejects.toThrow('NEXT_REDIRECT:/');
    expect(writeCalls(calls)).toEqual([]);
  });
});

describe('R11 import by a Member', () => {
  it('returns field errors and touches nothing when validation fails', async () => {
    const { calls } = use({}, MEMBER);
    const result = await importCorpse(initialImportState, importForm({ title: '', pastedCode: '' }));
    expect(Object.keys(result.errors).sort()).toEqual(['code', 'title']);
    expect(result.values.language).toBe('es5-jquery');
    expect(calls.filter(([m]) => m === 'from')).toEqual([]);
  });

  it('inserts an owned, non-sample, INFECTED corpse with the normalized code and its hash', async () => {
    const { calls } = use([{ data: null }, { count: 3 }, { data: { id: 'new-corpse-id' } }], MEMBER);
    await expect(importCorpse(initialImportState, importForm())).rejects.toThrow('NEXT_REDIRECT:/corpses/new-corpse-id');
    const insert = calls.find(([m]) => m === 'insert') as [string, [Record<string, unknown>]];
    expect(insert[1][0]).toMatchObject({
      user_id: MEMBER_ID,
      is_sample: false,
      status: 'INFECTED',
      title: 'Legacy module',
      source_language: 'es5-jquery',
      original_code: 'var a = 1;\n',
      repo_url: null,
    });
    expect(insert[1][0]['code_hash']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('redirects to the existing corpse instead of inserting a duplicate', async () => {
    const { calls } = use({ data: { id: 'existing-id' } }, MEMBER);
    await expect(importCorpse(initialImportState, importForm())).rejects.toThrow(
      'NEXT_REDIRECT:/corpses/existing-id?notice=already-imported',
    );
    expect(writeCalls(calls)).toEqual([]);
  });

  it('rejects the import at the corpse limit without writing', async () => {
    const { calls } = use([{ data: null }, { count: 100 }], MEMBER);
    const result = await importCorpse(initialImportState, importForm());
    expect(result.message).toContain('limit of 100');
    expect(writeCalls(calls)).toEqual([]);
  });

  it('shows a generic message when the database rejects the insert', async () => {
    use([{ data: null }, { count: 0 }, { error: { code: '42501', message: 'new row violates row-level security policy for table "corpses"' } }], MEMBER);
    const result = await importCorpse(initialImportState, importForm());
    expect(result.message).toBe('The corpse could not be saved. Try again later.');
    expect(JSON.stringify(result)).not.toContain('row-level security');
    expect(JSON.stringify(result)).not.toContain('42501');
  });

  it('rejects an oversize upload before reading it into text', async () => {
    const { calls } = use({}, MEMBER);
    const form = importForm({ pastedCode: '' });
    form.set('file', new File(['a'.repeat(102_401)], 'big.js', { type: 'text/javascript' }));
    const result = await importCorpse(initialImportState, form);
    expect(result.errors.code).toContain('larger than 100 KB');
    expect(calls.filter(([m]) => m === 'from')).toEqual([]);
  });

  it('accepts an uploaded file and rejects invalid UTF-8', async () => {
    use([{ data: null }, { count: 0 }, { data: { id: 'file-corpse' } }], MEMBER);
    const form = importForm({ pastedCode: '' });
    form.set('file', new File(['var fromFile = true;'], 'a.js', { type: 'text/javascript' }));
    await expect(importCorpse(initialImportState, form)).rejects.toThrow('NEXT_REDIRECT:/corpses/file-corpse');

    use({}, MEMBER);
    const bad = importForm({ pastedCode: '' });
    bad.set('file', new File([new Uint8Array([0xff, 0xfe, 0x80])], 'bad.js'));
    const result = await importCorpse(initialImportState, bad);
    expect(result.errors.code).toContain('not valid UTF-8');
  });
});

describe('R12 delete by a Member', () => {
  const form = (id: string) => {
    const data = new FormData();
    data.set('id', id);
    return data;
  };

  it('deletes by id and redirects to the Crypt', async () => {
    const { calls } = use({ data: [{ id: OTHER_ID }] }, MEMBER);
    await expect(deleteCorpse(form(OTHER_ID))).rejects.toThrow('NEXT_REDIRECT:/crypt?notice=deleted');
    expect(calls).toContainEqual(['eq', ['id', OTHER_ID]]);
    expect(calls.filter(([m]) => m === 'delete')).toHaveLength(1);
  });

  it('reports a non-revealing failure when zero rows were deleted', async () => {
    use({ data: [] }, MEMBER);
    await expect(deleteCorpse(form(OTHER_ID))).rejects.toThrow('NEXT_REDIRECT:/crypt?notice=delete-failed');
  });

  it('fails the same way for a database error and for an invalid id, without touching the database', async () => {
    use({ error: { code: '42501', message: 'denied' } }, MEMBER);
    await expect(deleteCorpse(form(OTHER_ID))).rejects.toThrow('NEXT_REDIRECT:/crypt?notice=delete-failed');
    const { calls } = use({}, MEMBER);
    await expect(deleteCorpse(form('not-a-uuid'))).rejects.toThrow('NEXT_REDIRECT:/crypt?notice=delete-failed');
    expect(calls.filter(([m]) => m === 'from')).toEqual([]);
  });
});

describe('R6 sign-out by a Member', () => {
  it('signs out and redirects home', async () => {
    const { calls } = use({}, MEMBER);
    await expect(signOut()).rejects.toThrow('NEXT_REDIRECT:/');
    expect(calls.filter(([m]) => m === 'signOut')).toHaveLength(1);
  });
});