import { signInWithGitHub } from '@/app/sign-in/actions';
import { signOut } from '@/app/auth/actions';
import { Button } from '@/components/ui/button';
import type { Viewer } from '@/lib/auth/viewer';

export function AuthControl({ viewer }: { viewer: Viewer | null }) {
  if (!viewer) {
    return (
      <form action={signInWithGitHub}>
        <Button type="submit" variant="outline">
          Sign in with GitHub
        </Button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {viewer.avatarUrl ? (
        // The avatar comes from GitHub as an https URL. A plain img avoids a remote image allowlist.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={viewer.avatarUrl} alt="" width={28} height={28} className="size-7 rounded-full" referrerPolicy="no-referrer" />
      ) : (
        <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-muted text-xs">
          {viewer.displayName.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="max-w-40 truncate text-sm" title={viewer.displayName}>
        {viewer.displayName}
      </span>
      <form action={signOut}>
        <Button type="submit" variant="ghost" size="sm">
          Sign out
        </Button>
      </form>
    </div>
  );
}