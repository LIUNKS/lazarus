import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { loadCorpse } from '@/lib/data/load-corpse';
import { isUuid } from '@/lib/security/uuid';

/**
 * Decides the 404 before the loading skeleton starts streaming, so the response status is a real 404.
 * A missing corpse, a corpse of another user, and an invalid id all end in the same notFound() page.
 * A data failure is left to the page, which shows the generic error state.
 */
export default async function CorpseLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  let found = true;
  try {
    found = (await loadCorpse(id)) !== null;
  } catch {
    found = true;
  }
  if (!found) notFound();
  return children;
}