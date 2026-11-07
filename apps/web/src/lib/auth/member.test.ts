import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

const { getCurrentMember, memberFromClaims, requireMember } = await import('./member');

const ID = '3f6c1b2e-7a4d-4e8b-9c15-2d0a8b6f4e73';

const clientWith = (result: { data: { claims: Record<string, unknown> } | null; error: unknown }) => ({
  auth: { getClaims: async () => result },
});

describe('R5 member from verified claims', () => {
  it('maps sub and email', () => {
    expect(memberFromClaims({ sub: ID, email: 'a@example.test' })).toEqual({ id: ID, email: 'a@example.test' });
  });

  it.each([undefined, null, {}, { sub: 'not-a-uuid' }, { sub: 42 }])('returns null for %j', (claims) => {
    expect(memberFromClaims(claims as Record<string, unknown> | null | undefined)).toBeNull();
  });

  it('uses null when the email is absent or blank', () => {
    expect(memberFromClaims({ sub: ID })?.email).toBeNull();
    expect(memberFromClaims({ sub: ID, email: '' })?.email).toBeNull();
  });

  it('returns the Member when getClaims succeeds', async () => {
    expect(await getCurrentMember(clientWith({ data: { claims: { sub: ID } }, error: null }))).toEqual({ id: ID, email: null });
  });

  it('returns null when getClaims reports an error or no data', async () => {
    expect(await getCurrentMember(clientWith({ data: null, error: new Error('bad token') }))).toBeNull();
    expect(await getCurrentMember(clientWith({ data: { claims: { sub: ID } }, error: new Error('x') }))).toBeNull();
    expect(await getCurrentMember(clientWith({ data: null, error: null }))).toBeNull();
  });

  it('redirects a Visitor to sign-in with an encoded safe path', async () => {
    const visitor = clientWith({ data: null, error: null });
    await expect(requireMember('/crypt?page=2', visitor)).rejects.toThrow('NEXT_REDIRECT:/sign-in?next=%2Fcrypt%3Fpage%3D2');
  });

  it('falls back to / when the requested path is unsafe', async () => {
    const visitor = clientWith({ data: null, error: null });
    await expect(requireMember('//evil.test', visitor)).rejects.toThrow('NEXT_REDIRECT:/sign-in?next=%2F');
  });

  it('returns the Member without redirecting', async () => {
    const member = await requireMember('/crypt', clientWith({ data: { claims: { sub: ID } }, error: null }));
    expect(member.id).toBe(ID);
  });
});