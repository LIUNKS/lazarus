import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-3xl font-semibold">Nothing rests here</h1>
      <p className="text-muted-foreground">The page you looked for does not exist, or you cannot see it.</p>
      <Link href="/" className="underline underline-offset-4">
        Back to The Morgue
      </Link>
    </div>
  );
}