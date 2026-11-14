import { verificationDeps } from '@/lib/verification/deps';
import { handleVerify } from '@/lib/verification/verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Seconds. Worst case: compile 10 s, run 10 s, 2 s kill grace, and the 5 s quota call.
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleVerify(request, verificationDeps());
}
