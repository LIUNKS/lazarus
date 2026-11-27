import { HeartbeatLarge, RaisedHandIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import { VERIFICATION_LABELS, type VerificationView } from '@/lib/stages/verification';

const TONE_CLASSES: Record<VerificationView['tone'], string> = {
  verified: 'border-verified bg-verified/10 glow-verified',
  curse: 'border-curse bg-curse/10',
  neutral: 'border-border bg-card',
};

/**
 * The verification result as empirical evidence. The state is always written out as a text label, so color is never the only
 * signal, and the verified color appears only for a verified result (with its heartbeat line). All text comes from
 * `buildVerificationView`.
 */
export function VerificationEvidence({ view }: { view: VerificationView }) {
  const verified = view.tone === 'verified';
  return (
    <div
      data-reveal
      data-verification-state={view.state}
      className={cn('flex flex-col gap-4 rounded-md border p-5 sm:flex-row sm:items-center sm:gap-6 sm:px-6', TONE_CLASSES[view.tone])}
    >
      {verified ? <HeartbeatLarge data-evidence-pulse className="h-11 w-[120px] shrink-0 text-verified" /> : null}
      {verified ? <RaisedHandIcon data-evidence-handclassName="size-9 shrink-0 text-verified" /> : null}
      <div className="min-w-0 space-y-1.5">
        <p className="text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">{VERIFICATION_LABELS[view.state]}</p>
        <h3 className="font-serif text-xl leading-snug font-semibold">{view.headline}</h3>
        {view.details.map((detail, index) => (
          <p key={index} className="text-sm text-muted-foreground">
            {detail}
          </p>
        ))}
      </div>
    </div>
  );
}
