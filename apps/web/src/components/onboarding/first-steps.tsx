import Link from 'next/link';
import { FIRST_STEPS, MODEL_SOURCE_LABEL } from '@/lib/onboarding/copy';

/** The steps of a first resurrection, for a Member who has not imported anything yet. */
export function FirstSteps() {
  return (
    <div className="space-y-4 rounded-xl border border-dashed border-border p-6">
      <h3 className="text-lg font-medium">Nothing buried yet. Your first resurrection:</h3>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        {FIRST_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">The Séance and the Reincarnation accept sources up to {MODEL_SOURCE_LABEL}.</p>
      <Link href="/import" className="inline-block text-sm underline underline-offset-4">
        Import legacy code
      </Link>
    </div>
  );
}
