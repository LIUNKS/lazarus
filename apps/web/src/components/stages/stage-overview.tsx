import type { ReactNode } from 'react';
import { HexScannerIcon, LaboratoryIcon, SeanceIcon } from '@/components/icons';
import type { StageSummary } from '@/lib/stages/controls';
import { cn } from '@/lib/utils';

const ICONS = {
  'hex-scanner': <HexScannerIcon className="size-[34px] text-curse-text" />,
  'seance-chamber': <SeanceIcon className="size-[34px] text-spectral" />,
  laboratory: <LaboratoryIcon className="size-[34px] text-verified" />,
} satisfies Record<StageSummary['id'], ReactNode>;

/**
 * Links to the three stages as a stepper of arched tombstones, with the state of each one in words. It is plain
 * server-rendered HTML. The furthest stage that has started is the current step; a verified laboratory glows emerald.
 */
export function StageOverview({ summaries }: { summaries: readonly StageSummary[] }) {
  const current = summaries.findLastIndex((summary) => summary.state !== 'Not started');
  return (
    <nav aria-label="Resurrection stages">
      <ol className="grid gap-5 sm:grid-cols-3">
        {summaries.map((summary, index) => {
          const verified = summary.id === 'laboratory' && summary.state === 'Verified';
          return (
            <li key={summary.id}>
              <a
                href={`#${summary.id}`}
                aria-current={index === current ? 'step' : undefined}
                className={cn(
                  'flex flex-col items-center gap-2.5 rounded-t-[120px] rounded-b-md border border-b-[3px] px-5 pt-7 pb-5 text-center transition-colors hover:bg-secondary',
                  verified
                    ? 'border-verified bg-linear-to-b from-verified/15 to-card to-70% glow-verified'
                    : 'border-border bg-card',
                )}
              >
                {ICONS[summary.id]}
                <span className="block font-serif text-lg font-semibold">{summary.name}</span>
                <span className={cn('block text-sm', verified ? 'font-medium text-verified' : 'text-muted-foreground')}>
                  {summary.state}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
