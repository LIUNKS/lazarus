'use client';

import Link from 'next/link';
import { GhostArt } from '@/components/icons';
import { Button } from '@/components/ui/button';

/** Error boundary. It shows a generic message and the digest only, never the error message or stack. */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <GhostArt />
      <h1 className="font-serif text-3xl font-bold">Something went wrong</h1>
      <p className="text-muted-foreground">An unexpected error stopped this page. You can try again.</p>
      {error.digest ? <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p> : null}
      <div className="flex flex-wrap items-center justify-center gap-4">
        <Button type="button" variant="outline" onClick={reset} className="min-h-11 px-5">
          Try again
        </Button>
        <Link href="/" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-primary">
          Back to The Morgue
        </Link>
      </div>
    </div>
  );
}
