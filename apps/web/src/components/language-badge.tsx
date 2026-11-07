import { Badge } from '@/components/ui/badge';
import type { SourceLanguage } from '@/lib/data/types';
import { languageLabel } from '@/lib/ui/status';

export function LanguageBadge({ language }: { language: SourceLanguage }) {
  return <Badge variant="outline">{languageLabel(language)}</Badge>;
}