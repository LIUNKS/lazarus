import { productionDeps } from '@/lib/pipeline/deps';
import { handleReincarnate } from '@/lib/pipeline/routes/reincarnate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Seconds. The Request_Deadline is 100 seconds, so the platform limit must be larger.
export const maxDuration = 120;

export async function POST(request: Request): Promise<Response> {
  return handleReincarnate(request, productionDeps());
}
