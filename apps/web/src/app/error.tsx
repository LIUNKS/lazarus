'use client';

import Link from 'next/link';

/** Error boundary. It shows a generic message and the digest only, never the error message or stack. */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-3xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground">An unexpected error stopped this page. You can try again.</p>
      {error.digest ? <p className="text-xs text-muted-foreground">Reference: {error.digest}</p> : null}
      <div className="flex items-center justify-center gap-4">
        <button type="button" onClick={reset} className="underline underline-offset-4">
          Try again
        </button>
        <Link href="/" className="underline underline-offset-4">
          Back to The Morgue
        </Link>
      </div>
    </div>
  );
}