import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeCorpse, reincarnationRow, seanceRow } from '@/lib/testing/harness';
import { buildVerifyHarness, checkVerifyResponse, OWNED_ID, verifyRequest } from '@/lib/testing/verification-arbitraries';
import { createGate, createSandboxPort, type LiveRequest } from './sandbox';
import { handleVerify } from './verify';

const WORKER = new URL('../../../../../packages/sandbox-runner/dist/worker/exec-entry.js', import.meta.url);
const SEED_DIR = new URL('../../../../../db/seed/', import.meta.url);

interface Fixture {
  name: string;
  language: 'es3' | 'es5-jquery' | 'legacy-node';
  legacy: string;
  modern: string;
  test: string;
  entry: string;
}

function fixture(name: string): Fixture {
  const read = (file: string) => readFileSync(new URL(`${name}/${file}`, SEED_DIR), 'utf8');
  const sample = JSON.parse(read('sample.json')) as { sourceLanguage: Fixture['language']; entryFunction: string };
  return { name, language: sample.sourceLanguage, legacy: read('legacy.js'), modern: read('modern.ts'), test: read('test-code.js'), entry: sample.entryFunction };
}

/** Runs the route over one fixture with the real Sandbox_Runner behind a test-only Gate with execution on. */
async function verify(f: Fixture, modern = f.modern) {
  if (!existsSync(WORKER)) {
    throw new Error('packages/sandbox-runner/dist is missing. Run: pnpm --filter @lazarus/sandbox-runner build');
  }
  const requests: LiveRequest[] = [];
  const port = createSandboxPort(createGate({ userExecutionEnabled: true, allowAnonymousSampleRuns: false, perUserConcurrency: 1, globalConcurrency: 4 }));
  const harness = buildVerifyHarness({
    corpses: [makeCorpse({ originalCode: f.legacy, sourceLanguage: f.language, status: 'IN_SEANCE' })],
    reincarnations: [reincarnationRow(OWNED_ID, { modernCode: modern, pbtTestCode: f.test })],
    seances: [seanceRow(OWNED_ID, { invariantsJson: { entry_function: f.entry, input: 'input', output: 'output', invariants: ['deterministic'] } })],
  });
  harness.deps.sandbox = {
    run(request) {
      requests.push(request);
      return port.run(request);
    },
  };
  const checked = await checkVerifyResponse(await handleVerify(verifyRequest({ corpseId: OWNED_ID }), harness.deps));
  return { checked, requests, harness };
}

describe('wiring with the real Sandbox_Runner', () => {
  it.each(['invoice-totals', 'query-string-parser'])('R11.9 the seed fixture %s is verified across 1,000 inputs and the corpse is RESURRECTED (Requirement 11)', async (name) => {
    const { checked, requests } = await verify(fixture(name));
    expect(checked.status).toBe(200);
    expect(checked.body).toMatchObject({
      source: 'executed',
      reincarnation: { pbtPassed: true, totalRuns: 1_000, verification: 'VERIFIED', evidence: 'Verified behavioral equivalence across 1,000 generated inputs.' },
      corpse: { status: 'RESURRECTED' },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ origin: 'user', numRuns: 1_000 });
  }, 30_000);

  it('R11.9 the seed fixture batch-calculator calls eval, so with dynamic code off the run is inconclusive and nothing is stored (Requirement 11)', async () => {
    // Its legacy code uses eval (an EVAL_INJECTION curse). The route never enables dynamic code (Requirement 6
    // criterion 2), so the Sandbox_Runner reports SANDBOX_FORBIDDEN_CAPABILITY. See the task notes of task 7.8.
    const { checked, harness } = await verify(fixture('batch-calculator'));
    expect(checked.code).toBe('VERIFICATION_INCONCLUSIVE');
    expect(harness.store.verdictWrites).toEqual([]);
    expect(harness.logs.find((line) => line.event === 'verification_run')).toMatchObject({ code: 'SANDBOX_FORBIDDEN_CAPABILITY' });
  }, 30_000);

  it('R7.7 a modern version with a difference is stored as FAILED with its counterexample count (Requirement 7)', async () => {
    const f = fixture('invoice-totals');
    // Same function, but the total is off by one for every order with more than one line.
    const original = 'total: round2(taxable + tax),';
    expect(f.modern).toContain(original);
    const broken = f.modern.replace(original, 'total: round2(taxable + tax) + (order.items.length > 1 ? 1 : 0),');
    const { checked } = await verify(f, broken);
    expect(checked.status).toBe(200);
    const body = checked.body as { source: string; reincarnation: { pbtPassed: boolean; totalRuns: number; verification: string }; corpse: { status: string } };
    expect(body.source).toBe('executed');
    expect(body.reincarnation.pbtPassed).toBe(false);
    expect(body.reincarnation.verification).toBe('FAILED');
    expect(body.reincarnation.totalRuns).toBeGreaterThanOrEqual(1);
    expect(body.reincarnation.totalRuns).toBeLessThanOrEqual(1_000);
    expect(body.corpse.status).toBe('FAILED');
  }, 30_000);
});
