import { HexScannerIcon, LaboratoryIcon, MorgueIcon, SeanceIcon } from '@/components/icons';
import { STAGES } from '@/lib/onboarding/copy';

// Stage identity: foreground, curse, spectral, verified (top rule and icon color, plus the "Stage n" label so color is not the only signal).
const STAGE_STYLE = [
  { icon: <MorgueIcon className="size-7" />, rule: 'border-t-foreground', tone: 'text-foreground' },
  { icon: <HexScannerIcon className="size-7" />, rule: 'border-t-curse', tone: 'text-curse-text' },
  { icon: <SeanceIcon className="size-7" />, rule: 'border-t-spectral', tone: 'text-spectral' },
  { icon: <LaboratoryIcon className="size-7" />, rule: 'border-t-verified', tone: 'text-verified' },
];

/** The four stages of a resurrection in one strip, for every viewer of the Morgue. */
export function HowItWorks() {
  return (
    <section aria-labelledby="how-it-works-heading" className="relative space-y-5">
      <h2 id="how-it-works-heading" className="font-serif text-sm font-semibold tracking-[0.2em] text-muted-foreground uppercase">
        How it works
      </h2>
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STAGES.map((stage, index) => {
          const style = STAGE_STYLE[index] ?? STAGE_STYLE[0]!;
          return (
            <li key={stage.lead} className={`panel flex flex-col gap-2.5 border-t-2 p-5 ${style.rule}`}>
              <span className={style.tone}>{style.icon}</span>
              <span className="text-xs tracking-wider text-muted-foreground uppercase">Stage {index + 1}</span>
              <span className="font-serif text-[19px] font-semibold">{stage.lead}</span>
              <span className="text-sm leading-relaxed text-muted-foreground">{stage.text}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
