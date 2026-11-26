import Link from 'next/link';
import { GitHubSignInButton } from '@/components/onboarding/github-sign-in-button';
import { Button } from '@/components/ui/button';
import { TRUST_LINE } from '@/lib/onboarding/copy';

/**
 * The invitation at the end of a sample corpse page. A Visitor gets the sign-in button; a Member, who is already signed
 * in, gets a link to the import page. The page renders it only for a Sample_Corpse.
 */
export function SampleInvite({ signedIn }: { signedIn: boolean }) {
  return (
    <aside aria-labelledby="sample-invite-heading" className="panel space-y-3 p-6">
      <h2 id="sample-invite-heading" className="text-xl font-semibold">
        Like what you saw?
      </h2>
      {signedIn ? (
        <>
          <p className="text-sm text-muted-foreground">Run the same four stages on your own legacy JavaScript.</p>
          <Button asChild>
            <Link href="/import">Import legacy code</Link>
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">Sign in with GitHub to run the same four stages on your own legacy JavaScript.</p>
          <GitHubSignInButton next="/import" />
          <p className="text-xs text-muted-foreground">{TRUST_LINE}</p>
        </>
      )}
    </aside>
  );
}
