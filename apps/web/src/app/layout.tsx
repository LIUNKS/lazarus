import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { SkipLink } from '@/components/skip-link';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Lazarus', template: '%s | Lazarus' },
  description: 'Resurrect dead JavaScript into strict, verified TypeScript.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="flex min-h-dvh flex-col">
        <SkipLink />
        <SiteHeader />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 outline-none sm:px-6">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}