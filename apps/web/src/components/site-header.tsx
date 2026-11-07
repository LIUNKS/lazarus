import Link from 'next/link';
import { AuthControl } from '@/components/auth-control';
import { Reveal } from '@/animations/reveal-section';
import { getViewer } from '@/lib/auth/viewer';

export async function SiteHeader() {
  const viewer = await getViewer();

  return (
    <header className="border-b border-border">
      <Reveal className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-6" data-reveal>
          <Link href="/" className="font-serif text-xl font-semibold tracking-tight">
            Lazarus
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-4 text-sm">
            <Link href="/" className="text-muted-foreground hover:text-foreground">
              Morgue
            </Link>
            {viewer ? (
              <>
                <Link href="/crypt" className="text-muted-foreground hover:text-foreground">
                  Crypt
                </Link>
                <Link href="/import" className="text-muted-foreground hover:text-foreground">
                  Import
                </Link>
              </>
            ) : null}
          </nav>
        </div>
        <div data-reveal>
          <AuthControl viewer={viewer} />
        </div>
      </Reveal>
    </header>
  );
}