import Link from 'next/link';
import type { ReactNode } from 'react';
import { LanguageBadge } from '@/components/language-badge';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CorpseSummary } from '@/lib/data/types';
import { formatDateUtc, pluralize } from '@/lib/ui/format';

/**
 * The title is rendered as a text child, so markup inside it is shown literally and never interpreted.
 * `actions` sit next to the link, not inside it, so no interactive element is nested in another.
 */
export function CorpseCard({ corpse, actions }: { corpse: CorpseSummary; actions?: ReactNode }) {
  return (
    <li data-reveal className="flex flex-col gap-2">
      <Link
        href={`/corpses/${corpse.id}`}
        className="block flex-1 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <Card className="h-full transition-colors hover:bg-accent/40">
          <CardHeader>
            <CardTitle className="font-serif text-lg break-words">{corpse.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <LanguageBadge language={corpse.sourceLanguage} />
              <StatusBadge status={corpse.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              <time dateTime={corpse.createdAt}>{formatDateUtc(corpse.createdAt)}</time>
              {' · '}
              {pluralize(corpse.curseCount, 'curse')}
            </p>
          </CardContent>
        </Card>
      </Link>
      {actions ? <div>{actions}</div> : null}
    </li>
  );
}