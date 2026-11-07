import Link from 'next/link';
import { CorpseGrid } from '@/components/corpse-grid';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { Notice } from '@/components/notice';
import { getViewer } from '@/lib/auth/viewer';
import { listOwnedCorpses, listSampleCorpses, OWNED_LIST_LIMIT } from '@/lib/data/corpses';
import type { CorpseSummary } from '@/lib/data/types';
import { authErrorMessage, firstParam } from '@/lib/messages';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function load(memberId: string | null): Promise<
  { ok: true; samples: CorpseSummary[]; owned: CorpseSummary[] } | { ok: false }
> {
  try {
    const supabase = await createClient();
    const samples = await listSampleCorpses(supabase);
    const owned = memberId ? (await listOwnedCorpses(supabase, memberId, { page: 1, pageSize: OWNED_LIST_LIMIT })).items : [];
    return { ok: true, samples, owned };
  } catch {
    return { ok: false };
  }
}

export default async function MorguePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const authError = authErrorMessage(firstParam(params['auth_error']));
  const viewer = await getViewer();
  const data = await load(viewer?.member.id ?? null);

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold">The Morgue</h1>
        <p className="max-w-2xl text-muted-foreground">
          Dead JavaScript lies here. Open a sample corpse to read its legacy source, or sign in to import your own.
        </p>
        {authError ? <Notice tone="curse">{authError}</Notice> : null}
        {!viewer ? (
          <Notice title="You are exploring in read-only mode">
            The samples below are read-only and their results are precomputed. Sign in with GitHub to import your own
            code and keep a private history in The Crypt.
          </Notice>
        ) : null}
      </section>

      {!data.ok ? (
        <ErrorState what="the corpses" />
      ) : (
        <>
          <section className="space-y-4" aria-labelledby="samples-heading">
            <h2 id="samples-heading" className="text-xl font-semibold">
              Sample corpses
            </h2>
            {data.samples.length === 0 ? (
              <EmptyState title="The samples are not loaded">
                Apply the database migrations with <code>pnpm db:migrate</code> to load the three sample corpses.
              </EmptyState>
            ) : (
              <CorpseGrid corpses={data.samples} label="Sample corpses" />
            )}
          </section>

          {viewer ? (
            <section className="space-y-4" aria-labelledby="owned-heading">
              <h2 id="owned-heading" className="text-xl font-semibold">
                Your corpses
              </h2>
              {data.owned.length === 0 ? (
                <EmptyState title="Nothing buried yet" action={{ href: '/import', label: 'Import legacy code' }}>
                  Import a legacy JavaScript file to see it here.
                </EmptyState>
              ) : (
                <>
                  <CorpseGrid corpses={data.owned} label="Your corpses" />
                  <p className="text-sm text-muted-foreground">
                    <Link href="/crypt" className="underline underline-offset-4">
                      Open The Crypt
                    </Link>{' '}
                    for your full history.
                  </p>
                </>
              )}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}