import Link from 'next/link';
import { TombstoneArt } from '@/components/icons';

export default function NotFound() {
  return (
    <div className="relative mx-auto flex max-w-md flex-col items-center gap-4 overflow-hidden py-16 text-center">
      <div aria-hidden="true" className="fog-b absolute inset-x-0 bottom-0 h-32 opacity-60 [mask-composite:intersect] [mask-image:linear-gradient(to_right,transparent,black_30%,black_70%,transparent),linear-gradient(to_bottom,transparent,black_60%,transparent)] [-webkit-mask-composite:source-in]"
      />
      <TombstoneArt className="relative" />
      <h1 className="relative font-serif text-3xl font-bold">Nothing rests here</h1>
      <p className="relative text-muted-foreground">The page you looked for does not exist, or you cannot see it.</p>
      <Link href="/" className="relative inline-flex min-h-11 items-center underline underline-offset-4 hover:text-primary">
        Back to The Morgue
      </Link>
    </div>
  );
}
