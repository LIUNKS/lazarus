import { CapabilityList } from '@/components/onboarding/capability-list';
import { GitHubSignInButton } from '@/components/onboarding/github-sign-in-button';
import { TRUST_LINE, usageNote, type LiveFlags } from '@/lib/onboarding/copy';

/** The Morgue block for a Visitor: what signing in adds, the sign-in button, and what GitHub shares. */
export function SignInInvite({ live }: { live: LiveFlags }) {
  return (
    <section aria-labelledby="invite-heading" className="space-y-4 rounded-xl border border-border bg-card p-6">
      <div className="space-y-1">
        <h2 id="invite-heading" className="text-xl font-semibold">
          Resurrect your own code
        </h2>
        <p className="text-sm text-muted-foreground">The samples show the whole workflow. Sign in with GitHub to run it on your own code.</p>
      </div>
      <CapabilityList live={live} />
      <div className="space-y-2">
        <GitHubSignInButton next="/import" />
        <p className="text-xs text-muted-foreground">{TRUST_LINE}</p>
        <p className="text-xs text-muted-foreground">{usageNote(live)}</p>
      </div>
    </section>
  );
}
