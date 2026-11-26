import Link from 'next/link';
import { AuthControl } from '@/components/auth-control';
import { BatsFlock, LazarusMark } from '@/components/icons';
import { NavLink } from '@/components/nav-link';
import { Reveal } from '@/animations/reveal-section';
import { getViewer } from '@/lib/auth/viewer';

export async function SiteHeader() {
  const viewer = await getViewer();

  return (
    <header className="relative z-10 border-b border-border bg-background/75">
      <Reveal className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-7 gap-y-2 px-4 py-3 sm:px-6 sm:py-3.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-7 gap-y-2" data-reveal>
          <Link href="/" className="flex items-center gap-2 text-foreground hover:text-foreground sm:gap-2.5">
            <LazarusMark className="size-[26px] text-ember sm:size-[30px]" />
            <span className="font-frak text-[26px] leading-none tracking-[0.5px] sm:text-[30px]">Lazarus</span>
          </Link>
          <nav aria-label="Primary" className="order-last flex w-full items-center gap-[18px] text-sm sm:order-none sm:w-auto sm:gap-5">
            <NavLink href="/">Morgue</NavLink>
            {viewer ? (
              <>
                <NavLink href="/crypt">Crypt</NavLink>
                <NavLink href="/import">Import</NavLink>
              </>
            ) : null}
          </nav>
        </div>
        <div className="flex items-center gap-[18px]" data-reveal>
          <BatsFlock className="hidden text-muted-foreground md:block" />
          <AuthControl viewer={viewer} />
        </div>
      </Reveal>
    </header>
  );
}
