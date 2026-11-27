import Link from 'next/link';
import { CandleIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { FIRST_STEPS, MODEL_SOURCE_LABEL } from '@/lib/onboarding/copy';

/** The steps of a first resurrection, for a Member who has not imported anything yet. */
export function FirstSteps() {
  return (
    <div className="panel space-y-4 border-dashed p-6">
      <div className="flex items-center gap-3">
        <CandleIcon className="size-7 shrink-0 text-primary" />
        <h3 className="text-lg font-medium">Nothing buried yet. Your first resurrection:</h3>
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground marker:text-primary">
        {FIRST_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">The Séance and the Reincarnation accept sources up to {MODEL_SOURCE_LABEL}.</p>
      <Button asChild>
        <Link href="/import">Import legacy code</Link>
      </Button>
    </div>
  );
}
