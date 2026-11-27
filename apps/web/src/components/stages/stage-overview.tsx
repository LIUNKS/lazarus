import type { ReactNode } from 'react';
import { HexScannerIcon, LaboratoryIcon, SeanceIcon } from '@/components/icons';
import type { StageSummary } from '@/lib/stages/controls';
import { cn } from '@/lib/utils';

const ICONS = {
  'hex-scanner': <HexScannerIcon className="size-7 sm:size-[34px] text-curse-text" />,
  'seance-chamber': <SeanceIcon className="size-7 sm:size-[34px] text-spectral" />,
  laboratory: <LaboratoryIcon className="size-7 sm:size-[34px] text-verified" />,
} satisfies Record<StageSummary['id'], ReactNode>;

/**
 * Links to the three stages as a stepper of arched tombstones, with the state of each one in words. It is plain
 * server-rendered HTML. The furthest stage that has started is the current step; a verified laboratory glows emerald.
 */
export function StageOverview({ summaries }: { summaries: readonly StageSummary[] }) {
  const current = summaries.findLastIndex((summary) => summary.state !== 'Not started');
  return (
    <nav aria-label="Resurrection stages">
      <ol className="grid grid-cols-3 gap-2 sm:gap-5">
        {summaries.map((summary, index) => {
          const verified = summary.id === 'laboratory' && summary.state === 'Verified';
          return (
            <li key={summary.id}>
              <a
                href={`#${summary.id}`}
                aria-current={index === current ? 'step' : undefined}
                className={cn(
                  'flex flex-col items-center min-h-11 gap-1.5 rounded-t-[60px] rounded-b-sm border border-b-[3px] px-1.5 pt-4 pb-3 sm:gap-2.5 sm:rounded-t-[120px] sm:rounded-b-md sm:px-5 sm:pt-7 sm:pb-5 text-center transition-colors hover:bg-secondary',
                  verified
                    ? 'border-verified bg-linear-to-b from-verified/15 to-card to-70% glow-verified'
                    : 'border-border bg-card',
                )}
              >
                {ICONS[summary.id]}
                <span className="block font-serif text-sm leading-tight font-semibold sm:text-lg">{summary.name}</span>
                <span className={cn('block text-xs sm:text-sm', verified ? 'font-medium text-verified' : 'text-muted-foreground')}>
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
