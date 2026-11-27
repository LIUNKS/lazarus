import Link from 'next/link';
import type { ReactNode } from 'react';
import { LanguageBadge } from '@/components/language-badge';
import { StatusBadge } from '@/components/status-badge';
import type { CorpseSummary } from '@/lib/data/types';
import { formatDateUtc, pluralize } from '@/lib/ui/format';

/**
 * A toe tag: clipped top-left corner, punched hole, dashed rule. The title is rendered as a text child, so markup inside
 * it is shown literally and never interpreted. `actions` sit next to the link, not inside it, so no interactive element
 * is nested in another.
 */
export function CorpseCard({ corpse, actions, tag }: { corpse: CorpseSummary; actions?: ReactNode; tag?: number }) {
  return (
    <li data-reveal className="flex flex-col gap-2">
      <Link
        href={`/corpses/${corpse.id}`}
        className="group relative block flex-1 bg-border p-px transition-[translate,background-color] duration-200 [clip-path:polygon(28px_0,100%_0,100%_100%,0_100%,0_28px)] hover:bg-ring/70 focus-visible:bg-ring focus-visible:outline-2 focus-visible:outline-offset-2 motion-safe:hover:-translate-y-0.5"
      >
        <span className="relative flex h-full flex-col gap-4 bg-card px-5 pt-6 pb-5 [clip-path:polygon(27px_0,100%_0,100%_100%,0_100%,0_27px)]">
          <span
            aria-hidden="true"
            className="absolute top-3.5 left-3.5 size-3 rounded-full border-[1.5px] border-muted-foreground bg-background"
          />
          <span className="pl-5 text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
            {tag ? `Tag no. ${String(tag).padStart(3, '0')}` : 'Toe tag'}
          </span>
          <span className="font-serif text-xl leading-snug font-semibold break-words">{corpse.title}</span>
          <span aria-hidden="true" className="h-px [background:repeating-linear-gradient(90deg,var(--border)_0_6px,transparent_6px_10px)]" />
          <span className="flex flex-wrap items-center gap-2">
            <LanguageBadge language={corpse.sourceLanguage} />
            <StatusBadge status={corpse.status} />
          </span>
          <span className="text-[13px] text-muted-foreground">
            <time dateTime={corpse.createdAt}>{formatDateUtc(corpse.createdAt)}</time>
            {' · '}
            {pluralize(corpse.curseCount, 'curse')}
          </span>
        </span>
      </Link>
      {actions ? <div>{actions}</div> : null}
    </li>
  );
}
