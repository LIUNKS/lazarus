import { BloodDropSmallIcon, HexSigilIcon, SkullCrossbonesIcon } from '@/components/icons';

/** The glyph of a severity (decorative: the severity is always written out as text next to it). Unknown severities get the hex sigil. */
export function SeverityGlyph({ severity, className }: { severity: string; className?: string }) {
  if (severity === 'FATAL') return <SkullCrossbonesIcon className={className} />;
  if (severity === 'BLOOD_CURSE') return <BloodDropSmallIcon className={className} />;
  return <HexSigilIcon className={className} />;
}
