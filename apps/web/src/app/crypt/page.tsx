import Link from 'next/link';
import { CorpseGrid } from '@/components/corpse-grid';
import { DeleteCorpseButton } from '@/components/delete-corpse-button';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { Notice } from '@/components/notice';
import { requireMember } from '@/lib/auth/member';
import { listOwnedCorpses, OWNED_LIST_LIMIT } from '@/lib/data/corpses';
import { IMPORT_LIMITS } from '@/lib/import/limits';
import { firstParam, noticeMessage } from '@/lib/messages';
import { pageCount, parsePage } from '@/lib/pagination';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'The Crypt' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CryptPage({ searchParams }: { searchParams: SearchParams }) {
  const member = await requireMember('/crypt');
  const params = await searchParams;
  const page = parsePage(firstParam(params['page']));
  const notice = noticeMessage(firstParam(params['notice']));

  let result: Awaited<ReturnType<typeof listOwnedCorpses>>;
  try {
    result = await listOwnedCorpses(await createClient(), member.id, { page, pageSize: OWNED_LIST_LIMIT });
  } catch {
    return <ErrorState what="your corpses" />;
  }

  const pages = pageCount(result.total, OWNED_LIST_LIMIT);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">The Crypt</h1>
        <p className="text-muted-foreground">
          Your private history. {result.total} of {IMPORT_LIMITS.maxCorpses} corpses used.
        </p>
        {notice ? <Notice>{notice}</Notice> : null}
      </header>

      {result.total === 0 ? (
        <EmptyState title="The Crypt is empty" action={{ href: '/import', label: 'Import legacy code' }}>
          Corpses you import appear here, visible only to you.
        </EmptyState>
      ) : result.items.length === 0 ? (
        <EmptyState title="No corpses on this page" action={{ href: '/crypt', label: 'Back to the first page' }}>
          This page is past the end of your history.
        </EmptyState>
      ) : (
        <CorpseGrid
          corpses={result.items}
          label="Your corpses"
          renderActions={(corpse) => <DeleteCorpseButton corpseId={corpse.id} title={corpse.title} />}
        />
      )}

      {pages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={`/crypt?page=${page - 1}`} className="underline underline-offset-4">
              Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={`/crypt?page=${page + 1}`} className="underline underline-offset-4">
              Older
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}