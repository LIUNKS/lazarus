import type { ReactNode } from 'react';
import type { StageSummary } from '@/lib/stages/controls';
import { stageHeadingId } from '@/lib/stages/copy';

/**
 * One stage of the corpse page: a `section` labeled by its heading. The heading takes focus after a successful action
 * (`tabIndex={-1}` makes that possible without adding a tab stop).
 */
export function StageSection({ id, title, children }: { id: StageSummary['id']; title: string; children: ReactNode }) {
  const headingId = stageHeadingId(id);
  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-20 space-y-4">
      <h2 id={headingId} tabIndex={-1} className="text-xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}
