import { Badge } from '@/components/ui/badge';
import { FailedIcon, InfectedIcon, InSeanceIcon, ResurrectedIcon } from '@/components/icons';
import type { CorpseStatus } from '@/lib/data/types';
import { cn } from '@/lib/utils';
import { statusPresentation, TONE_CLASSES } from '@/lib/ui/status';

const STATUS_ICONS = {
  INFECTED: <InfectedIcon />,
  FAILED: <FailedIcon />,
  IN_SEANCE: <InSeanceIcon className="text-spectral" />,
  RESURRECTED: <ResurrectedIcon />,
} satisfies Record<CorpseStatus, React.ReactNode>;

/** Icon plus label: color is never the only signal. */
export function StatusBadge({ status }: { status: CorpseStatus }) {
  const { label, tone } = statusPresentation(status);
  return (
    <Badge className={cn(TONE_CLASSES[tone])}>
      {STATUS_ICONS[status]}
      {label}
    </Badge>
  );
}
