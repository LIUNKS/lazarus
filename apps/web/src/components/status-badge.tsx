import { Badge } from '@/components/ui/badge';
import type { CorpseStatus } from '@/lib/data/types';
import { cn } from '@/lib/utils';
import { statusPresentation, TONE_CLASSES } from '@/lib/ui/status';

export function StatusBadge({ status }: { status: CorpseStatus }) {
  const { label, tone } = statusPresentation(status);
  return <Badge className={cn(TONE_CLASSES[tone])}>{label}</Badge>;
}