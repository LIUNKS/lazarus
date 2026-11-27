import type { Metadata } from 'next';
import { Cinzel, JetBrains_Mono, UnifrakturCook } from 'next/font/google';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { SkipLink } from '@/components/skip-link';
import './globals.css';

const cinzel = Cinzel({ subsets: ['latin'], weight: ['400', '600', '700'], variable: '--font-cinzel', display: 'swap' });
const unifraktur = UnifrakturCook({ subsets: ['latin'], weight: '700', variable: '--font-unifraktur', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Lazarus', template: '%s | Lazarus' },
  description: 'Resurrect dead JavaScript into strict, verified TypeScript.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`dark ${cinzel.variable} ${unifraktur.variable} ${jetbrains.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <SkipLink />
        <SiteHeader />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 outline-none sm:px-6">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}