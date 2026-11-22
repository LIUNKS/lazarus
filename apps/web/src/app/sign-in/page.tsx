import { redirect } from 'next/navigation';
import { signInWithGitHub } from '@/app/sign-in/actions';
import { CapabilityList } from '@/components/onboarding/capability-list';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getViewer } from '@/lib/auth/viewer';
import { TRUST_LINE } from '@/lib/onboarding/copy';
import { liveFlags } from '@/lib/onboarding/live-flags';
import { safeRedirectPath } from '@/lib/security/safe-redirect';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in' };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  if (await getViewer()) redirect('/');
  const params = await searchParams;
  const next = safeRedirectPath(Array.isArray(params.next) ? params.next[0] : params.next) ?? '/';

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Sign in</CardTitle>
          <CardDescription>
            Sign in with GitHub to import your own legacy code and keep a private history in The Crypt. You can explore
            the samples without signing in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <CapabilityList live={liveFlags()} />
          <div className="space-y-2">
            <form action={signInWithGitHub}>
              <input type="hidden" name="next" value={next} />
              <Button type="submit" className="w-full">
                Continue with GitHub
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">{TRUST_LINE}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}