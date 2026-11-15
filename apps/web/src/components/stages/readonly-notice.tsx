import Link from 'next/link';
import { Notice } from '@/components/notice';
import type { StageAccess } from '@/lib/stages/controls';
import { safeRedirectPath } from '@/lib/security/safe-redirect';

/**
 * The notice for a viewer who cannot run anything. A Visitor gets a link to sign in, and a Member looking at a sample
 * does not. The owner gets no notice.
 */
export function ReadonlyNotice({ access, currentPath }: { access: StageAccess; currentPath: string }) {
  if (access === 'owner') return null;
  if (access === 'member-viewer') {
    return <Notice>Sample results are precomputed and read-only.</Notice>;
  }
  const next = safeRedirectPath(currentPath) ?? '/';
  return (
    <Notice>
      These results are precomputed and read-only.{' '}
      <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className="underline underline-offset-4">
        Sign in
      </Link>{' '}
      to run the stages on your own code.
    </Notice>
  );
}
