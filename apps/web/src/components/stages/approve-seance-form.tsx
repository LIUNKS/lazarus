'use client';

import { useFormStatus } from 'react-dom';
import { approveSeance } from '@/app/corpses/actions';
import { Button } from '@/components/ui/button';

// `useFormStatus` reads the status of the form that contains it, so the button is its own component.
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? 'Approving…' : 'Approve spec'}
    </Button>
  );
}

/** Approves the stored séance. The Server Action checks the Member again and writes only `approved_at`. */
export function ApproveSeanceForm({ corpseId }: { corpseId: string }) {
  return (
    <form action={approveSeance} className="space-y-2">
      <input type="hidden" name="id" value={corpseId} />
      <SubmitButton />
      <p className="text-xs text-muted-foreground">Review the extracted spec, then approve it to enable reincarnation.</p>
    </form>
  );
}
