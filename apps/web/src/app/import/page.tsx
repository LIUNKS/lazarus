import { ImportForm } from '@/app/import/import-form';
import { requireMember } from '@/lib/auth/member';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Import legacy code' };

export default async function ImportPage() {
  await requireMember('/import');
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Import legacy code</h1>
        <p className="text-muted-foreground">
          The code is stored as text in your private Crypt. It is not run, parsed, or sent to any model at this step.
        </p>
      </header>
      <ImportForm />
    </div>
  );
}