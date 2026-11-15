import { cn } from '@/lib/utils';
import { VERIFICATION_LABELS, type VerificationView } from '@/lib/stages/verification';

const TONE_CLASSES: Record<VerificationView['tone'], string> = {
  verified: 'border-verified bg-verified/10',
  curse: 'border-curse bg-curse/10',
  neutral: 'border-border bg-card',
};

/**
 * The verification result as empirical evidence. The state is always written out as a text label, so color is never the only
 * signal, and the verified color appears only for a verified result. All text comes from `buildVerificationView`.
 */
export function VerificationEvidence({ view }: { view: VerificationView }) {
  return (
    <div data-reveal data-verification-state={view.state} className={cn('space-y-2 rounded-lg border p-4', TONE_CLASSES[view.tone])}>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{VERIFICATION_LABELS[view.state]}</p>
      <h3 className="text-lg font-semibold">{view.headline}</h3>
      {view.details.map((detail, index) => (
        <p key={index} className="text-sm text-muted-foreground">
          {detail}
        </p>
      ))}
    </div>
  );
}
