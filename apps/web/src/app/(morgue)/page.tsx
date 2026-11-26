import { getImageProps } from 'next/image';
import Link from 'next/link';
import { ScrambleHeading } from '@/animations/scramble-heading';
import { Button } from '@/components/ui/button';
import { CorpseGrid } from '@/components/corpse-grid';
import { FirstSteps } from '@/components/onboarding/first-steps';
import { HowItWorks } from '@/components/onboarding/how-it-works';
import { SignInInvite } from '@/components/onboarding/sign-in-invite';
import { liveFlags } from '@/lib/onboarding/live-flags';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { CobwebCorner } from '@/components/icons';
import { Notice } from '@/components/notice';
import { getViewer } from '@/lib/auth/viewer';
import { listOwnedCorpses, listSampleCorpses, OWNED_LIST_LIMIT } from '@/lib/data/corpses';
import type { CorpseSummary } from '@/lib/data/types';
import { authErrorMessage, firstParam } from '@/lib/messages';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const HEADING_CLASS = 'font-serif text-5xl leading-[1.02] font-bold tracking-wide sm:text-7xl';

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
  const common = { alt: '', priority: true, quality: 80 } as const;
  const { props: desktop } = getImageProps({ ...common, src: '/images/hero-graveyard-desktop.webp', width: 1920, height: 1088, sizes: '(min-width: 1152px) 1152px, 100vw' });
  const { props: mobile } = getImageProps({ ...common, src: '/images/hero-graveyard-mobile.webp', width: 832, height: 1472, sizes: '100vw' });

  return (
    <div className="space-y-14">
      <section
        aria-labelledby="morgue-heading"
        className="relative isolate overflow-hidden rounded-lg border border-border"
      >
        <picture>
          <source media="(min-width: 768px)" srcSet={desktop.srcSet} sizes={desktop.sizes} />
          <img
            {...mobile}
            alt=""
            className="absolute inset-0 -z-30 size-full object-cover object-bottom md:object-[right_center]"
          />
        </picture>
        {/* Overlay: dark behind the copy (>= 4.5:1 for bone text), clear where the graveyard shows. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-20 bg-[linear-gradient(180deg,rgb(9_9_11/0.9)_0%,rgb(9_9_11/0.6)_45%,rgb(9_9_11/0)_70%,#09090b_100%)] md:bg-[linear-gradient(90deg,#09090b_0%,rgb(9_9_11/0.92)_30%,rgb(9_9_11/0.2)_62%,transparent_80%)]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-20 hidden bg-[linear-gradient(0deg,#09090b_0%,transparent_38%)] md:block"
        />
        <div aria-hidden="true" className="fog-a absolute inset-x-0 bottom-0 -z-10 h-56 opacity-[0.14] md:h-80" />
        <div aria-hidden="true" className="fog-b absolute inset-x-0 -bottom-10 -z-10 h-48 opacity-[0.14] md:h-64" />
        <CobwebCorner className="pointer-events-none absolute top-0 left-0 size-16 text-muted-foreground/40" />
        <div className="relative flex min-h-[34rem] flex-col gap-5 px-5 pt-14 pb-16 sm:px-8 md:min-h-[40rem] md:justify-center md:pt-24 md:pb-24">
          <p className="text-[13px] font-semibold tracking-[0.2em] text-primary uppercase">Legacy JavaScript, raised as TypeScript</p>
          <ScrambleHeading text="The Morgue" className={`max-w-xl ${HEADING_CLASS}`} />
          <p className="max-w-md text-lg leading-relaxed">
            Dead JavaScript lies here. Open a sample corpse to read its legacy source, or sign in to import your own.
          </p>
          {authError ? <Notice tone="curse">{authError}</Notice> : null}
          <div className="mt-2 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <a href="#samples-heading">Open a sample corpse</a>
            </Button>
            {!viewer ? (
              <Button asChild variant="outline" size="lg" className="bg-card/80">
                <a href="#sign-in">Sign in with GitHub</a>
              </Button>
            ) : null}
          </div>
        </div>
      </section>
      <HowItWorks />

      {!data.ok ? (
        <ErrorState what="the corpses" />
      ) : (
        <>
          <section className="space-y-4" aria-labelledby="samples-heading">
            <div className="space-y-1.5">
              <h2 id="samples-heading" className="font-serif text-3xl font-semibold tracking-wide">
                Sample corpses
              </h2>
              {!viewer ? (
                <p className="text-sm text-muted-foreground">Read-only. Their results are precomputed, so you can explore every stage without signing in.</p>
              ) : null}
            </div>
            {data.samples.length === 0 ? (
              <EmptyState title="The samples are not loaded">
                Apply the database migrations with <code>pnpm db:migrate</code> to load the three sample corpses.
              </EmptyState>
            ) : (
              <CorpseGrid corpses={data.samples} label="Sample corpses" />
            )}
          </section>

          {!viewer ? <SignInInvite live={liveFlags()} /> : null}
          {viewer ? (
            <section className="space-y-4" aria-labelledby="owned-heading">
              <h2 id="owned-heading" className="font-serif text-3xl font-semibold tracking-wide">
                Your corpses
              </h2>
              {data.owned.length === 0 ? (
                <FirstSteps />
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