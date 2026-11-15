import { productionDeps } from '@/lib/pipeline/deps';
import { handleScan } from '@/lib/pipeline/routes/scan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleScan(request, productionDeps());
}
