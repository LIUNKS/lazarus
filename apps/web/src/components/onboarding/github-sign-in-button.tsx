import { signInWithGitHub } from '@/app/sign-in/actions';
import { Button } from '@/components/ui/button';

/** Starts the GitHub sign-in and returns to `next` (checked again by the Server Action). */
export function GitHubSignInButton({ next, label = 'Sign in with GitHub' }: { next: string; label?: string }) {
  return (
    <form action={signInWithGitHub}>
      <input type="hidden" name="next" value={next} />
      <Button type="submit" size="lg">{label}</Button>
    </form>
  );
}
