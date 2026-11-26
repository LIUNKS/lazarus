import { capabilities, type LiveFlags } from '@/lib/onboarding/copy';

// Sigil colors follow the stage they belong to; the lead word carries the meaning, so color is never the only signal.
const SIGIL_TONES = ['text-primary', 'text-curse-text', 'text-spectral', 'text-verified', 'text-foreground'];

/** What a Member can do, from the limit constants and the server decisions for live verification. */
export function CapabilityList({ live }: { live: LiveFlags }) {
  return (
    <ul aria-label="What you can do after signing in" className="space-y-3 text-sm leading-relaxed">
      {capabilities(live).map((item, index) => (
        <li key={item.lead} className="flex gap-2.5">
          <span aria-hidden="true" className={SIGIL_TONES[index % SIGIL_TONES.length]}>
            ✦
          </span>
          <span>
            <span className="font-semibold">{item.lead}</span> <span className="text-muted-foreground">{item.text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
