import type { ReactNode } from 'react';
import { Reveal } from '@/animations/reveal-section';
import { CorpseCard } from '@/components/corpse-card';
import type { CorpseSummary } from '@/lib/data/types';

export function CorpseGrid({
  corpses,
  label,
  renderActions,
}: {
  corpses: CorpseSummary[];
  label: string;
  renderActions?: (corpse: CorpseSummary) => ReactNode;
}) {
  return (
    <Reveal>
      <ul aria-label={label} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {corpses.map((corpse) => (
          <CorpseCard key={corpse.id} corpse={corpse} actions={renderActions?.(corpse)} />
        ))}
      </ul>
    </Reveal>
  );
}