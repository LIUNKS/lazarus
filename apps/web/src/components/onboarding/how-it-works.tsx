import { STAGES } from '@/lib/onboarding/copy';

/** The four stages of a resurrection in one strip, for every viewer of the Morgue. */
export function HowItWorks() {
  return (
    <section aria-labelledby="how-it-works-heading" className="space-y-3">
      <h2 id="how-it-works-heading" className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
        How it works
      </h2>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STAGES.map((stage, index) => (
          <li key={stage.lead} className="rounded-lg border border-border bg-card p-3">
            <span className="block text-xs text-muted-foreground">Stage {index + 1}</span>
            <span className="block font-medium">{stage.lead}</span>
            <span className="mt-1 block text-sm text-muted-foreground">{stage.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
