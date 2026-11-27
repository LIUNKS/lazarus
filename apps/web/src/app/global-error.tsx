'use client';

/** Last-resort boundary: it replaces the root layout, so it renders its own html and body. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en" style={{ colorScheme: 'dark' }}>
      <body style={{ background: '#09090b', color: '#ece4d4', fontFamily: 'system-ui, sans-serif', padding: '4rem 1rem', textAlign: 'center' }}>
        <h1>Something went wrong</h1>
        <p style={{ color: '#a49d90' }}>An unexpected error stopped the application.</p>
        {error.digest ? <p style={{ color: '#a49d90', fontSize: '0.75rem' }}>Reference: {error.digest}</p> : null}
        <a href="/" style={{ color: '#f2832b' }}>
          Back to The Morgue
        </a>
      </body>
    </html>
  );
}