import type { ReactNode } from 'react';
import { requireMember } from '@/lib/auth/member';

// The check runs in the layout so a Visitor gets a real redirect before any content streams.
export default async function ImportLayout({ children }: { children: ReactNode }) {
  await requireMember('/import');
  return children;
}