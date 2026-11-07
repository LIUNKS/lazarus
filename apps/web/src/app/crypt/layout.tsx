import type { ReactNode } from 'react';
import { requireMember } from '@/lib/auth/member';

// The check runs in the layout so a Visitor gets a real redirect before the loading skeleton starts streaming.
export default async function CryptLayout({ children }: { children: ReactNode }) {
  await requireMember('/crypt');
  return children;
}