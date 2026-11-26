import { CobwebCorner } from '@/components/icons';
import { CapabilityList } from '@/components/onboarding/capability-list';
import { GitHubSignInButton } from '@/components/onboarding/github-sign-in-button';
import { TRUST_LINE, usageNote, type LiveFlags } from '@/lib/onboarding/copy';

/** The Morgue block for a Visitor: what signing in adds, the sign-in button, and what GitHub shares. */
export function SignInInvite({ live }: { live: LiveFlags }) {
  return (
    <section id="sign-in" aria-labelledby="invite-heading" className="panel relative grid gap-8 overflow-hidden p-6 sm:p-9 lg:grid-cols-2">
      <CobwebCorner className="pointer-events-none absolute top-0 right-0 size-20 text-muted-foreground/40" />
      <div className="relative space-y-3">
        <h2 id="invite-heading" className="font-serif text-3xl font-semibold tracking-wide">
          Resurrect your own code
        </h2>
        <p className="leading-relaxed text-muted-foreground">The samples show the whole workflow. Sign in with GitHub to run it on your own code.</p>
        <div className="space-y-2.5 pt-3">
          <GitHubSignInButton next="/import" />
          <p className="text-xs leading-normal text-muted-foreground">{TRUST_LINE}</p>
          <p className="text-xs leading-normal text-muted-foreground">{usageNote(live)}</p>
        </div>
      </div>
      <div className="relative">
        <CapabilityList live={live} />
      </div>
    </section>
  );
}
