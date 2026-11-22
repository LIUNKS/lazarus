import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { AnchorGlide } from '@/animations/anchor-glide';
import { ScanBeam } from '@/animations/scan-beam';
import { ScrollProgress } from '@/animations/scroll-progress';
import { CodeView } from '@/components/code-view';
import { DeleteCorpseButton } from '@/components/delete-corpse-button';
import { ErrorState } from '@/components/error-state';
import { LanguageBadge } from '@/components/language-badge';
import { Notice } from '@/components/notice';
import { StageSections } from '@/components/stages/stage-sections';
import { StagesSkeleton } from '@/components/stages/stages-skeleton';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { getViewer } from '@/lib/auth/viewer';
import { loadCorpse } from '@/lib/data/load-corpse';
import type { CorpseDetail } from '@/lib/data/types';
import { firstParam, noticeMessage } from '@/lib/messages';
import { isUuid } from '@/lib/security/uuid';
import { buildScannerView, countSourceLines } from '@/lib/stages/scanner-view';
import { formatDateUtc } from '@/lib/ui/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Corpse' };

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function isHttpsUrl(value: string | null): value is string {
  if (value === null) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export default async function CorpsePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  // Not a UUID: answer 404 without querying the database.
  if (!isUuid(id)) notFound();

  let corpse: CorpseDetail | null;
  try {
    corpse = await loadCorpse(id);
  } catch {
    return <ErrorState what="this corpse" />;
  }
  // Missing, owned by someone else, or invisible to this role: the same 404, so existence is not revealed.
  if (!corpse) notFound();

  const viewer = await getViewer();
  const isOwner = viewer !== null && !corpse.isSample && corpse.userId === viewer.member.id;
  const notice = noticeMessage(firstParam((await searchParams)['notice']));
  // The curses are part of the corpse query, so the lines of the source are marked without waiting for the stage data.
  const scannerView = buildScannerView(corpse.curses, countSourceLines(corpse.originalCode));

  return (
    <article className="space-y-8">
      <header className="space-y-3">
        {notice ? <Notice>{notice}</Notice> : null}
        <h1 className="text-3xl font-semibold break-words">{corpse.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {corpse.isSample ? <Badge variant="secondary">Sample</Badge> : null}
          <LanguageBadge language={corpse.sourceLanguage} />
          <StatusBadge status={corpse.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          Created <time dateTime={corpse.createdAt}>{formatDateUtc(corpse.createdAt)}</time>
          {isHttpsUrl(corpse.repoUrl) ? (
            <>
              {' · '}
              <a href={corpse.repoUrl} rel="noopener noreferrer" target="_blank" className="underline underline-offset-4">
                Repository
              </a>
            </>
          ) : null}
        </p>
        {isOwner ? <DeleteCorpseButton corpseId={corpse.id} title={corpse.title} /> : null}
      </header>

      <section className="space-y-3" aria-labelledby="source-heading">
        <h2 id="source-heading" className="text-xl font-semibold">
          Legacy source
        </h2>
        <ScanBeam markedLines={[...scannerView.markedLines]} lineCount={countSourceLines(corpse.originalCode)}>
          <CodeView code={corpse.originalCode} markedLines={scannerView.markedLines} />
        </ScanBeam>
      </section>
      <AnchorGlide />
      <ScrollProgress />

      <Suspense fallback={<StagesSkeleton />}>
        <StageSections corpse={corpse} viewer={viewer} scannerView={scannerView} />
      </Suspense>
    </article>
  );
}