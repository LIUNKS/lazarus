import { readPublicConfig } from '@/lib/env';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Configuration error' };

export default function ConfigurationErrorPage() {
  const result = readPublicConfig();
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">Configuration error</h1>
      {result.ok ? (
        <p className="mt-4">No configuration problem was detected. Reload the page.</p>
      ) : (
        <>
          <p className="mt-4">The web app cannot reach Supabase because these variables are not set correctly:</p>
          <ul className="mt-4 list-disc pl-6">
            {result.problems.map((problem) => (
              <li key={problem.variable}>
                <code>{problem.variable}</code> is {problem.reason}
              </li>
            ))}
          </ul>
          <p className="mt-4">
            Copy <code>.env.example</code> to <code>.env</code> at the repository root and set these variables.
          </p>
        </>
      )}
    </div>
  );
}