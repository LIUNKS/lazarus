import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeClient, writeCalls, type FakeResult } from '@/lib/testing/fake-client';

const MEMBER_ID = '3f6c1b2e-7a4d-4e8b-9c15-2d0a8b6f4e73';
const CORPSE_ID = '9b2e4f61-3c7a-4d58-a1e0-6f8d2c5b7a94';

const state = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.client }));

const { approveSeance } = await import('@/app/corpses/actions');

const VISITOR = { data: null, error: null };
const MEMBER = { data: { claims: { sub: MEMBER_ID, email: 'm@example.test' } }, error: null };

function use(result: FakeResult | FakeResult[], claims: typeof VISITOR | typeof MEMBER) {
  const fake = fakeClient(result, claims);
  state.client = fake.client;
  return fake;
}

function form(id: string): FormData {
  const data = new FormData();
  data.set('id', id);
  return data;
}

/** The URL of the redirect that the action raised. */
async function redirectOf(action: Promise<void>): Promise<string> {
  const failure = await action.then(
    () => null,
    (error: unknown) => error,
  );
  const message = failure instanceof Error ? failure.message : '';
  expect(message).toMatch(/^NEXT_REDIRECT:/);
  return message.replace('NEXT_REDIRECT:', '');
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('R12 approveSeance', () => {
  it('R12.6 sends a Visitor to sign-in and calls no write method', async () => {
    const { calls } = use({}, VISITOR);
    expect(await redirectOf(approveSeance(form(CORPSE_ID)))).toBe(`/sign-in?next=${encodeURIComponent(`/corpses/${CORPSE_ID}`)}`);
    expect(writeCalls(calls)).toEqual([]);
    expect(calls.filter(([method]) => method === 'from')).toEqual([]);
  });

  it('R12.1 R12.2 issues one update that sets only approved_at, filtered by the corpse and a NULL approved_at', async () => {
    const before = Date.now();
    const { calls } = use({ data: [{ id: 'seance-1' }] }, MEMBER);
    await redirectOf(approveSeance(form(CORPSE_ID)));
    const writes = writeCalls(calls);
    expect(writes).toHaveLength(1);
    const [method, [payload]] = writes[0] as [string, [Record<string, unknown>]];
    expect(method).toBe('update');
    expect(Object.keys(payload)).toEqual(['approved_at']);
    const approvedAt = Date.parse(String(payload['approved_at']));
    expect(approvedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(approvedAt).toBeLessThanOrEqual(Date.now() + 1000);
    expect(String(payload['approved_at'])).toMatch(/Z$/);
    expect(calls).toContainEqual(['from', ['seance_specs']]);
    expect(calls).toContainEqual(['eq', ['corpse_id', CORPSE_ID]]);
    expect(calls).toContainEqual(['is', ['approved_at', null]]);
  });

  it('R12.2 does not insert, delete, upsert, or call a function', async () => {
    const { calls } = use({ data: [{ id: 'seance-1' }] }, MEMBER);
    await redirectOf(approveSeance(form(CORPSE_ID)));
    const methods = calls.map(([method]) => method);
    for (const forbidden of ['insert', 'delete', 'upsert', 'rpc']) expect(methods).not.toContain(forbidden);
  });

  it('R12.5 redirects to the séance section with the "approved" notice when a row was updated', async () => {
    use({ data: [{ id: 'seance-1' }] }, MEMBER);
    expect(await redirectOf(approveSeance(form(CORPSE_ID)))).toBe(`/corpses/${CORPSE_ID}?notice=approved#seance-chamber`);
  });

  it('R12.3 gives the generic notice when no row was updated, and does not report success', async () => {
    use({ data: [] }, MEMBER);
    const url = await redirectOf(approveSeance(form(CORPSE_ID)));
    expect(url).toBe(`/corpses/${CORPSE_ID}?notice=approve-failed#seance-chamber`);
    expect(url).not.toContain('notice=approved');
  });

  it('R12.4 gives the same generic notice when the database rejects the update, with no database text', async () => {
    use({ error: { code: '42501', message: 'new row violates row-level security policy for table seance_specs' } }, MEMBER);
    const url = await redirectOf(approveSeance(form(CORPSE_ID)));
    expect(url).toBe(`/corpses/${CORPSE_ID}?notice=approve-failed#seance-chamber`);
    expect(url).not.toMatch(/42501|row-level|policy|seance_specs/);
  });

  it('R12.4 logs the failure on the server', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    use({ error: { code: '42501', message: 'denied' } }, MEMBER);
    await redirectOf(approveSeance(form(CORPSE_ID)));
    expect(spy).toHaveBeenCalled();
  });

  it('R12.1 touches nothing for an id that is not a UUID', async () => {
    const { calls } = use({ data: [{ id: 'x' }] }, MEMBER);
    expect(await redirectOf(approveSeance(form('not-a-uuid')))).toBe('/crypt?notice=approve-failed');
    expect(calls.filter(([method]) => method === 'from')).toEqual([]);
    expect(writeCalls(calls)).toEqual([]);
  });

  it('R12.1 touches nothing when the id is missing', async () => {
    const { calls } = use({ data: [{ id: 'x' }] }, MEMBER);
    expect(await redirectOf(approveSeance(new FormData()))).toBe('/crypt?notice=approve-failed');
    expect(calls.filter(([method]) => method === 'from')).toEqual([]);
  });

  it('R14.3 builds the redirect only from a valid UUID and fixed notice codes, whatever text is posted', async () => {
    // Feature: 06-resurrection-ui, Supporting check: approveSeance never echoes the posted text
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 40 }), async (posted) => {
        const { calls } = use({ data: [{ id: 'x' }] }, MEMBER);
        const url = await redirectOf(approveSeance(form(posted)));
        const touched = calls.filter(([method]) => method === 'from').length;
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(posted);
        if (isUuid) return url.startsWith(`/corpses/${posted}?notice=`);
        return url === '/crypt?notice=approve-failed' && touched === 0;
      }),
      { numRuns: 100 },
    );
  });
});
