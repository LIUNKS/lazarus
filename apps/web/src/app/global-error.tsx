'use client';

/** Last-resort boundary: it replaces the root layout, so it renders its own html and body. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en" style={{ colorScheme: 'dark' }}>
      <body style={{ background: '#09090b', color: '#fafafa', fontFamily: 'system-ui, sans-serif', padding: '4rem 1rem', textAlign: 'center' }}>
        <h1>Something went wrong</h1>
        <p style={{ color: '#a1a1aa' }}>An unexpected error stopped the application.</p>
        {error.digest ? <p style={{ color: '#a1a1aa', fontSize: '0.75rem' }}>Reference: {error.digest}</p> : null}
        <a href="/" style={{ color: '#fafafa' }}>
          Back to The Morgue
        </a>
      </body>
    </html>
  );
}