import type { ReactNode } from 'react';
import { StageIconDraw } from '@/animations/stage-icon-draw';
import { HexScannerIcon, LaboratoryIcon, SeanceIcon } from '@/components/icons';
import type { StageSummary } from '@/lib/stages/controls';
import { stageHeadingId } from '@/lib/stages/copy';

const ICONS = {
  'hex-scanner': <HexScannerIcon className="size-[30px] text-curse-text" />,
  'seance-chamber': <SeanceIcon className="size-[30px] text-spectral" />,
  laboratory: <LaboratoryIcon className="size-[30px] text-verified" />,
} satisfies Record<StageSummary['id'], ReactNode>;

/**
 * One stage of the corpse page: a `section` labeled by its heading. The heading takes focus after a successful action
 * (`tabIndex={-1}` makes that possible without adding a tab stop).
 */
export function StageSection({ id, title, children }: { id: StageSummary['id']; title: string; children: ReactNode }) {
  const headingId = stageHeadingId(id);
  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-20 space-y-4">
      <div className="flex items-center gap-3">
        <StageIconDraw>{ICONS[id]}</StageIconDraw>
        <h2 id={headingId} tabIndex={-1} className="font-serif text-2xl font-semibold tracking-wider">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}
