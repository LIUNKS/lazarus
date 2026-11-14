// Verification_Suite: migration V4 (08-live-verification-api, Requirement 8). Skipped when TEST_DATABASE_URL is unset.
// Covers the verification ledger, public.reserve_verification_run, and public.record_verification.
import { randomUUID } from 'node:crypto';
import fc from 'fast-check';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabaseUrl } from './support/env.ts';
import { closePool, createWorld, dbDescribe, destroyWorld, getPool, inSandbox, type Attempt, type Sandbox, type World } from './support/db.ts';

const RESERVE =
  'SELECT allowed, denied_by, retry_after_seconds FROM public.reserve_verification_run($1, $2::interval, $3, $4::interval)';
const RECORD =
  'SELECT was_updated, stored_passed, stored_total_runs, stored_execution_time_ms, corpse_status FROM public.record_verification($1::uuid, $2, $3, $4)';

interface Verdict {
  allowed: boolean;
  deniedBy: string;
  retryAfterSeconds: number;
}

interface Limits {
  userLimit?: number;
  userWindowSeconds?: number;
  globalLimit?: number;
  globalWindowSeconds?: number;
}

/** The arguments the route passes (limits.ts): 10 per user per 60 minutes, 100 in total per 24 hours. */
const reserveArgs = (limits: Limits = {}) => [
  limits.userLimit ?? 10,
  `${limits.userWindowSeconds ?? 3_600} seconds`,
  limits.globalLimit ?? 100,
  `${limits.globalWindowSeconds ?? 86_400} seconds`,
];

function verdictOf(attempt: Attempt): Verdict {
  expect(attempt.ok, attempt.ok ? '' : attempt.message).toBe(true);
  if (!attempt.ok) throw new Error(attempt.message);
  const row = attempt.rows[0] ?? {};
  return { allowed: row['allowed'] as boolean, deniedBy: row['denied_by'] as string, retryAfterSeconds: row['retry_after_seconds'] as number };
}

interface Recorded {
  wasUpdated: boolean;
  passed: boolean | null;
  totalRuns: number | null;
  executionTimeMs: number | null;
  corpseStatus: string | null;
}

function recordedOf(attempt: Attempt): Recorded {
  expect(attempt.ok, attempt.ok ? '' : attempt.message).toBe(true);
  if (!attempt.ok) throw new Error(attempt.message);
  const row = attempt.rows[0] ?? {};
  return {
    wasUpdated: row['was_updated'] as boolean,
    passed: row['stored_passed'] as boolean | null,
    totalRuns: row['stored_total_runs'] as number | null,
    executionTimeMs: row['stored_execution_time_ms'] as number | null,
    corpseStatus: row['corpse_status'] as string | null,
  };
}

function expectCode(attempt: Attempt, code: string): void {
  expect(attempt.ok, 'statement should have been rejected').toBe(false);
  if (!attempt.ok) expect(attempt.code, attempt.message).toBe(code);
}

async function createUser(sandbox: Sandbox): Promise<string> {
  const id = randomUUID();
  await sandbox.admin('INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)', [id, `verify-${id}@example.test`, '{}']);
  return id;
}

/** The global limit counts every row, including rows other tests committed. The rollback restores them. */
async function isolateLedger(sandbox: Sandbox): Promise<void> {
  await sandbox.admin('DELETE FROM public.verification_usage_events');
}

async function ledgerCount(sandbox: Sandbox, userId?: string): Promise<number> {
  const rows = userId
    ? await sandbox.admin('SELECT count(*)::int AS n FROM public.verification_usage_events WHERE user_id = $1', [userId])
    : await sandbox.admin('SELECT count(*)::int AS n FROM public.verification_usage_events');
  return Number(rows[0]?.['n']);
}

type CorpseStatus = 'INFECTED' | 'IN_SEANCE' | 'RESURRECTED' | 'FAILED';

interface OwnedReincarnation {
  userId: string;
  corpseId: string;
  reincarnationId: string;
}

/** A corpse of a new user with one reincarnation, with or without a stored verdict. */
async function ownedReincarnation(sandbox: Sandbox, status: CorpseStatus = 'IN_SEANCE', verdict: boolean | null = null): Promise<OwnedReincarnation> {
  const userId = await createUser(sandbox);
  const corpseId = randomUUID();
  const reincarnationId = randomUUID();
  await sandbox.admin(
    `INSERT INTO public.corpses (id, user_id, is_sample, title, source_language, original_code, code_hash, status)
     VALUES ($1, $2, false, 'Verification test corpse', 'es5-jquery', 'function f(a){return a;}', 'hash', $3)`,
    [corpseId, userId, status],
  );
  await sandbox.admin(
    `INSERT INTO public.reincarnations (id, corpse_id, target_stack, modern_code, pbt_test_code, pbt_passed, total_runs, execution_time_ms)
     VALUES ($1, $2, 'TypeScript', 'export function f(a: number): number { return a; }', 'return null;', $3, $4, $5)`,
    [reincarnationId, corpseId, verdict, verdict === null ? null : 1000, verdict === null ? null : 50],
  );
  return { userId, corpseId, reincarnationId };
}

async function storedRow(sandbox: Sandbox, reincarnationId: string) {
  const rows = await sandbox.admin(
    `SELECT r.pbt_passed, r.total_runs, r.execution_time_ms, c.status
     FROM public.reincarnations r JOIN public.corpses c ON c.id = r.corpse_id WHERE r.id = $1`,
    [reincarnationId],
  );
  const row = rows[0] ?? {};
  return { passed: row['pbt_passed'] ?? null, totalRuns: row['total_runs'] ?? null, executionTimeMs: row['execution_time_ms'] ?? null, status: row['status'] ?? null };
}

async function sampleReincarnationId(sandbox: Sandbox): Promise<string> {
  const rows = await sandbox.admin(
    'SELECT r.id FROM public.reincarnations r JOIN public.corpses c ON c.id = r.corpse_id WHERE c.is_sample ORDER BY c.title LIMIT 1',
  );
  return String(rows[0]?.['id']);
}

let world: World | undefined;
const extraUserIds: string[] = [];

beforeAll(async () => {
  if (process.env['TEST_DATABASE_URL']) world = await createWorld();
});

afterAll(async () => {
  if (world) await destroyWorld(world);
  if (extraUserIds.length > 0) {
    // Deleting the users cascades to profiles and to their ledger rows.
    await getPool().query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [extraUserIds]);
  }
  await closePool();
});

dbDescribe('R8 migration V4: structure and privileges (Requirement 8)', () => {
  it('R8.1 R8.2 creates the ledger with RLS enabled, no policy, and the documented columns and indexes (Requirement 8)', async () => {
    await inSandbox(async (sandbox) => {
      const columns = await sandbox.admin(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'verification_usage_events' ORDER BY column_name`,
      );
      expect(columns.map((c) => [c['column_name'], c['data_type'], c['is_nullable']])).toEqual([
        ['created_at', 'timestamp with time zone', 'NO'],
        ['id', 'uuid', 'NO'],
        ['user_id', 'uuid', 'NO'],
      ]);
      const rls = await sandbox.admin("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.verification_usage_events'::regclass");
      expect(rls[0]?.['relrowsecurity']).toBe(true);
      const policies = await sandbox.admin("SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'verification_usage_events'");
      expect(policies[0]?.['n']).toBe(0);
      const indexes = await sandbox.admin("SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'verification_usage_events'");
      const defs = indexes.map((i) => String(i['indexdef']));
      expect(defs.some((d) => d.includes('(user_id, created_at)'))).toBe(true);
      expect(defs.some((d) => /\(created_at\)$/.test(d))).toBe(true);
    });
  });

  it('R8.11 anon can neither touch the ledger nor execute the new functions (Requirement 8)', async () => {
    await inSandbox(async (sandbox) => {
      for (const sql of [
        'SELECT * FROM public.verification_usage_events',
        'INSERT INTO public.verification_usage_events (user_id) VALUES (gen_random_uuid())',
        'UPDATE public.verification_usage_events SET created_at = now()',
        'DELETE FROM public.verification_usage_events',
      ]) {
        expectCode(await sandbox.as('anon', null, sql), '42501');
      }
      expectCode(await sandbox.as('anon', null, RESERVE, reserveArgs()), '42501');
      expectCode(await sandbox.as('anon', null, RECORD, [randomUUID(), true, 1000, 5]), '42501');
    });
  });

  it('R8.11 authenticated can neither select, insert, update, nor delete ledger rows directly (Requirement 8)', async () => {
    await inSandbox(async (sandbox) => {
      const userId = await createUser(sandbox);
      verdictOf(await sandbox.as('authenticated', userId, RESERVE, reserveArgs()));
      expect(await ledgerCount(sandbox, userId)).toBe(1);
      for (const sql of [
        'SELECT * FROM public.verification_usage_events',
        `INSERT INTO public.verification_usage_events (user_id) VALUES ('${userId}')`,
        'UPDATE public.verification_usage_events SET created_at = now()',
        'DELETE FROM public.verification_usage_events',
      ]) {
        expectCode(await sandbox.as('authenticated', userId, sql), '42501');
      }
      expect(await ledgerCount(sandbox, userId)).toBe(1);
    });
  });

  it('R8.5 R8.9 grants EXECUTE on both functions to authenticated only among the API roles (Requirement 8)', async () => {
    await inSandbox(async (sandbox) => {
      const rows = await sandbox.admin(
        `SELECT
           has_function_privilege('anon', 'public.reserve_verification_run(integer, interval, integer, interval)', 'EXECUTE') AS anon_reserve,
           has_function_privilege('authenticated', 'public.reserve_verification_run(integer, interval, integer, interval)', 'EXECUTE') AS auth_reserve,
           has_function_privilege('anon', 'public.record_verification(uuid, boolean, integer, integer)', 'EXECUTE') AS anon_record,
           has_function_privilege('authenticated', 'public.record_verification(uuid, boolean, integer, integer)', 'EXECUTE') AS auth_record`,
      );
      expect(rows[0]).toEqual({ anon_reserve: false, auth_reserve: true, anon_record: false, auth_record: true });
    });
  });

  it('R8.3 R8.6 declares the security mode and a fixed search_path for both functions (Requirement 8)', async () => {
    await inSandbox(async (sandbox) => {
      const rows = await sandbox.admin(
        `SELECT proname, prosecdef, proconfig FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace AND proname IN ('reserve_verification_run', 'record_verification') ORDER BY proname`,
      );
      expect(rows.map((r) => [r['proname'], r['prosecdef'], String(r['proconfig'])])).toEqual([
        ['record_verification', false, 'search_path=""'],
        ['reserve_verification_run', true, 'search_path=""'],
      ]);
    });
  });

  it('R8.12 the seeded database records four applied migrations (Requirement 8)', async () => {
    await inSandbox(async (sandbox) => {
      const history = await sandbox.admin('SELECT version FROM public.flyway_schema_history WHERE success ORDER BY installed_rank');
      expect(history.map((h) => h['version'])).toEqual(['1', '2', '3', '4']);
    });
  });
});

dbDescribe('R5 reserve_verification_run (Requirements 5 and 8)', () => {
  it('R8.11 allows 10 reservations in 60 minutes and denies the 11th with limit user and retry-after from 1 to 3,600 (Requirement 8)', async () => {
    await inSandbox(async (sandbox) => {
      const userId = await createUser(sandbox);
      for (let n = 1; n <= 10; n++) {
        expect(verdictOf(await sandbox.as('authenticated', userId, RESERVE, reserveArgs())), `call ${n}`).toEqual({ allowed: true, deniedBy: 'none', retryAfterSeconds: 0 });
      }
      const denied = verdictOf(await sandbox.as('authenticated', userId, RESERVE, reserveArgs()));
      expect(denied.allowed).toBe(false);
      expect(denied.deniedBy).toBe('user');
      expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(denied.retryAfterSeconds).toBeLessThanOrEqual(3_600);
      expect(await ledgerCount(sandbox, userId)).toBe(10);
    });
  });

  it('R8.11 the global limit denies with limit global when the calling user is under their own limit (Requirement 8)', async () => {
    await inSandbox(async (sandbox) => {
      await isolateLedger(sandbox);
      const users = [await createUser(sandbox), await createUser(sandbox), await createUser(sandbox)];
      for (const userId of users.slice(0, 2)) {
        expect(verdictOf(await sandbox.as('authenticated', userId, RESERVE, reserveArgs({ globalLimit: 2 }))).allowed).toBe(true);
      }
      const denied = verdictOf(await sandbox.as('authenticated', users[2]!, RESERVE, reserveArgs({ globalLimit: 2 })));
      expect(denied).toMatchObject({ allowed: false, deniedBy: 'global' });
      expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(denied.retryAfterSeconds).toBeLessThanOrEqual(86_400);
    });
  });

  it('R8.11 a denied call and an invalid call insert no row, and a missing user raises (Requirement 8)', async () => {
    await inSandbox(async (sandbox) => {
      const userId = await createUser(sandbox);
      verdictOf(await sandbox.as('authenticated', userId, RESERVE, reserveArgs({ userLimit: 1 })));
      const before = await ledgerCount(sandbox);
      expect(verdictOf(await sandbox.as('authenticated', userId, RESERVE, reserveArgs({ userLimit: 1 }))).allowed).toBe(false);
      const valid = reserveArgs();
      const invalid: unknown[][] = [
        [0, valid[1], valid[2], valid[3]],
        [null, valid[1], valid[2], valid[3]],
        [valid[0], '0 seconds', valid[2], valid[3]],
        [valid[0], null, valid[2], valid[3]],
        [valid[0], valid[1], -1, valid[3]],
        [valid[0], valid[1], null, valid[3]],
        [valid[0], valid[1], valid[2], '-5 minutes'],
        [valid[0], valid[1], valid[2], null],
      ];
      for (const args of invalid) expectCode(await sandbox.as('authenticated', userId, RESERVE, args), '22023');
      expectCode(await sandbox.as('authenticated', null, RESERVE, valid), '28000');
      expect(await ledgerCount(sandbox)).toBe(before);
    });
  });

  it('R8.11 reservations of one user do not count for another user (Requirement 8)', async () => {
    await inSandbox(async (sandbox) => {
      const [a, b] = [await createUser(sandbox), await createUser(sandbox)];
      for (let n = 0; n < 2; n++) verdictOf(await sandbox.as('authenticated', a, RESERVE, reserveArgs({ userLimit: 2 })));
      expect(verdictOf(await sandbox.as('authenticated', a, RESERVE, reserveArgs({ userLimit: 2 }))).allowed).toBe(false);
      expect(verdictOf(await sandbox.as('authenticated', b, RESERVE, reserveArgs({ userLimit: 2 }))).allowed).toBe(true);
    });
  });

  it('R5.9 the verification ledger and the LLM ledger never count each other (Requirement 5)', async () => {
    await inSandbox(async (sandbox) => {
      const userId = await createUser(sandbox);
      await sandbox.admin(
        "INSERT INTO public.llm_usage_events (user_id, route, created_at) SELECT $1, 'seance', clock_timestamp() - interval '1 minute' FROM generate_series(1, 10)",
        [userId],
      );
      // Ten LLM reservations do not use the user's verification quota.
      expect(verdictOf(await sandbox.as('authenticated', userId, RESERVE, reserveArgs({ userLimit: 1 }))).allowed).toBe(true);
      const llm = await sandbox.admin('SELECT count(*)::int AS n FROM public.llm_usage_events WHERE user_id = $1', [userId]);
      expect(llm[0]?.['n']).toBe(10);
      expect(await ledgerCount(sandbox, userId)).toBe(1);
    });
  });

  it('R8.4 deletes ledger rows older than 24 hours on a valid call and keeps younger rows (Requirement 8)', async () => {
    await inSandbox(async (sandbox) => {
      const userId = await createUser(sandbox);
      await sandbox.admin(
        `INSERT INTO public.verification_usage_events (user_id, created_at) VALUES
           ($1, clock_timestamp() - interval '25 hours'),
           ($1, clock_timestamp() - interval '23 hours 59 minutes'),
           ($1, clock_timestamp() - interval '1 minute')`,
        [userId],
      );
      verdictOf(await sandbox.as('authenticated', userId, RESERVE, reserveArgs()));
      expect(await ledgerCount(sandbox, userId)).toBe(3);
    });
  });

  it('R5.4 R8.11 15 concurrent reservations by one user in 60 minutes yield exactly 10 allowed results (Requirement 8)', async () => {
    const userId = randomUUID();
    extraUserIds.push(userId);
    await getPool().query('INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)', [userId, `concurrent-verify-${userId}@example.test`, '{}']);
    const pool = new pg.Pool({ connectionString: testDatabaseUrl(), max: 15 });
    try {
      const results = await Promise.all(
        Array.from({ length: 15 }, async () => {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await client.query('SET LOCAL ROLE authenticated');
            await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
            const result = await client.query(RESERVE, reserveArgs());
            await client.query('COMMIT');
            return result.rows[0]?.['allowed'] as boolean;
          } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw error;
          } finally {
            client.release();
          }
        }),
      );
      expect(results.filter(Boolean)).toHaveLength(10);
      const stored = await getPool().query('SELECT count(*)::int AS n FROM public.verification_usage_events WHERE user_id = $1', [userId]);
      expect(stored.rows[0]?.n).toBe(10);
    } finally {
      await pool.end();
    }
  });

  it('R5.2 R8.3 allows a call exactly when a rolling-window model does (Requirement 8)', async () => {
    // Feature: 08-live-verification-api, Property 10: Quota function matches a rolling-window model (database)
    // Ages end in half a second, so the few milliseconds between the insert and the call never cross a whole second.
    const age = fc.integer({ min: 0, max: 26 * 3_600 }).map((seconds) => seconds + 0.5);
    const scenario = fc.record({
      rows: fc.array(fc.record({ user: fc.integer({ min: 0, max: 2 }), age }), { maxLength: 40 }),
      caller: fc.integer({ min: 0, max: 2 }),
      userLimit: fc.integer({ min: 1, max: 30 }),
      globalLimit: fc.integer({ min: 1, max: 30 }),
      userWindow: fc.integer({ min: 60, max: 86_400 }),
      globalWindow: fc.integer({ min: 60, max: 86_400 }),
    });
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        return inSandbox(async (sandbox) => {
          await isolateLedger(sandbox);
          const users = [await createUser(sandbox), await createUser(sandbox), await createUser(sandbox)];
          for (const row of s.rows) {
            await sandbox.admin("INSERT INTO public.verification_usage_events (user_id, created_at) VALUES ($1, clock_timestamp() - make_interval(secs => $2))", [users[row.user], row.age]);
          }

          // Reference model.
          const kept = s.rows.filter((row) => row.age <= 86_400);
          const retryOf = (counted: number[], limit: number, window: number): number => {
            if (counted.length < limit) return 0;
            const oldestFirst = [...counted].sort((a, b) => b - a);
            const freeing = oldestFirst[counted.length - limit]!;
            return Math.min(86_400, Math.max(1, Math.ceil(window - freeing)));
          };
          const userRetry = retryOf(kept.filter((row) => row.user === s.caller && row.age < s.userWindow).map((row) => row.age), s.userLimit, s.userWindow);
          const globalRetry = retryOf(kept.filter((row) => row.age < s.globalWindow).map((row) => row.age), s.globalLimit, s.globalWindow);
          const allowed = userRetry === 0 && globalRetry === 0;
          const expected: Verdict = allowed
            ? { allowed: true, deniedBy: 'none', retryAfterSeconds: 0 }
            : { allowed: false, deniedBy: userRetry > 0 ? 'user' : 'global', retryAfterSeconds: Math.max(userRetry, globalRetry) };

          const verdict = verdictOf(await sandbox.as('authenticated', users[s.caller]!, RESERVE, reserveArgs({ userLimit: s.userLimit, userWindowSeconds: s.userWindow, globalLimit: s.globalLimit, globalWindowSeconds: s.globalWindow })));
          const remaining = await ledgerCount(sandbox);
          const otherUsers = await Promise.all(users.map((id, index) => (index === s.caller ? Promise.resolve(-1) : ledgerCount(sandbox, id))));
          const expectedOthers = users.map((_, index) => (index === s.caller ? -1 : kept.filter((row) => row.user === index).length));
          return (
            JSON.stringify(verdict) === JSON.stringify(expected) &&
            remaining === kept.length + (allowed ? 1 : 0) &&
            JSON.stringify(otherUsers) === JSON.stringify(expectedOthers)
          );
        });
      }),
      { numRuns: 100 },
    );
  }, 300_000);
});

dbDescribe('R7 record_verification (Requirements 7 and 8)', () => {
  it('R8.11 writes a pass once, sets RESURRECTED, and a second call returns was_updated false and keeps the first values (Requirement 8)', async () => {
    await inSandbox(async (sandbox) => {
      const owned = await ownedReincarnation(sandbox, 'IN_SEANCE');
      expect(recordedOf(await sandbox.as('authenticated', owned.userId, RECORD, [owned.reincarnationId, true, 1000, 420]))).toEqual({
        wasUpdated: true,
        passed: true,
        totalRuns: 1000,
        executionTimeMs: 420,
        corpseStatus: 'RESURRECTED',
      });
      expect(recordedOf(await sandbox.as('authenticated', owned.userId, RECORD, [owned.reincarnationId, false, 3, 10]))).toEqual({
        wasUpdated: false,
        passed: null,
        totalRuns: null,
        executionTimeMs: null,
        corpseStatus: null,
      });
      expect(await storedRow(sandbox, owned.reincarnationId)).toEqual({ passed: true, totalRuns: 1000, executionTimeMs: 420, status: 'RESURRECTED' });
    });
  });

  it('R8.11 a failure with fewer than 100 runs is stored and sets FAILED (Requirement 8)', async () => {
    await inSandbox(async (sandbox) => {
      const owned = await ownedReincarnation(sandbox, 'INFECTED');
      expect(recordedOf(await sandbox.as('authenticated', owned.userId, RECORD, [owned.reincarnationId, false, 7, 33]))).toMatchObject({
        wasUpdated: true,
        passed: false,
        totalRuns: 7,
        corpseStatus: 'FAILED',
      });
    });
  });

  it('R8.11 keeps a terminal corpse status (Requirement 8)', async () => {
    await inSandbox(async (sandbox) => {
      const failed = await ownedReincarnation(sandbox, 'FAILED');
      expect(recordedOf(await sandbox.as('authenticated', failed.userId, RECORD, [failed.reincarnationId, true, 1000, 1])).corpseStatus).toBe('FAILED');
      const resurrected = await ownedReincarnation(sandbox, 'RESURRECTED');
      expect(recordedOf(await sandbox.as('authenticated', resurrected.userId, RECORD, [resurrected.reincarnationId, false, 1, 1])).corpseStatus).toBe('RESURRECTED');
    });
  });

  it('R8.8 R8.11 rejects each invalid argument and a missing user, and changes nothing (Requirement 8)', async () => {
    await inSandbox(async (sandbox) => {
      const owned = await ownedReincarnation(sandbox, 'IN_SEANCE');
      const id = owned.reincarnationId;
      const invalid: unknown[][] = [
        [null, true, 1000, 1],
        [id, null, 1000, 1],
        [id, true, null, 1],
        [id, true, 1000, null],
        [id, true, 1000, -1],
        [id, true, 1001, 1],
        [id, false, 1001, 1],
        [id, true, 99, 1],
        [id, false, 0, 1],
      ];
      for (const args of invalid) expectCode(await sandbox.as('authenticated', owned.userId, RECORD, args), '22023');
      expectCode(await sandbox.as('authenticated', null, RECORD, [id, true, 1000, 1]), '28000');
      expect(await storedRow(sandbox, id)).toEqual({ passed: null, totalRuns: null, executionTimeMs: null, status: 'IN_SEANCE' });
    });
  });

  it('R8.9 R8.11 changes nothing for a sample, a corpse of another user, and a missing id (Requirement 8)', async () => {
    await inSandbox(async (sandbox) => {
      const mine = await ownedReincarnation(sandbox, 'IN_SEANCE');
      const other = await ownedReincarnation(sandbox, 'IN_SEANCE');
      const sample = await sampleReincarnationId(sandbox);
      const sampleBefore = await storedRow(sandbox, sample);
      for (const target of [other.reincarnationId, sample, randomUUID()]) {
        expect(recordedOf(await sandbox.as('authenticated', mine.userId, RECORD, [target, true, 1000, 1])).wasUpdated).toBe(false);
      }
      expect(await storedRow(sandbox, other.reincarnationId)).toEqual({ passed: null, totalRuns: null, executionTimeMs: null, status: 'IN_SEANCE' });
      expect(await storedRow(sandbox, sample)).toEqual(sampleBefore);
    });
  });

  it('R7.12 R8.11 two concurrent calls on one row leave exactly one result (Requirement 8)', async () => {
    const owner = world!.a;
    const pool = new pg.Pool({ connectionString: testDatabaseUrl(), max: 4 });
    const record = async (passed: boolean, runs: number) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE authenticated');
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [owner.userId]);
        const result = await client.query(RECORD, [owner.reincarnationId, passed, runs, 5]);
        await client.query('COMMIT');
        return result.rows[0] as Record<string, unknown>;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    };
    try {
      const [first, second] = await Promise.all([record(true, 1000), record(false, 12)]);
      expect([first?.['was_updated'], second?.['was_updated']].filter(Boolean)).toHaveLength(1);
      const winner = first?.['was_updated'] ? first : second;
      const stored = await getPool().query('SELECT pbt_passed, total_runs FROM public.reincarnations WHERE id = $1', [owner.reincarnationId]);
      expect(stored.rows[0]).toEqual({ pbt_passed: winner?.['stored_passed'], total_runs: winner?.['stored_total_runs'] });
    } finally {
      await pool.end();
    }
  });

  it('R7.6 R8.7 records a verdict exactly when the caller owns an unverified row and the arguments are valid (Requirement 8)', async () => {
    // Feature: 08-live-verification-api, Property 11: Verdict recording (database)
    type Relation = 'owned-unverified' | 'owned-verified' | 'sample' | 'foreign' | 'missing';
    const scenario = fc.record({
      relation: fc.constantFrom<Relation>('owned-unverified', 'owned-verified', 'sample', 'foreign', 'missing'),
      status: fc.constantFrom<CorpseStatus>('INFECTED', 'IN_SEANCE', 'RESURRECTED', 'FAILED'),
      passed: fc.oneof(fc.boolean(), fc.constant(null)),
      totalRuns: fc.oneof(fc.integer({ min: -2, max: 1_002 }), fc.constantFrom(0, 1, 99, 100, 1_000, 1_001), fc.constant(null)),
      executionTimeMs: fc.oneof(fc.integer({ min: -2, max: 100_000 }), fc.constant(null)),
    });
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        return inSandbox(async (sandbox) => {
          const caller = await ownedReincarnation(sandbox, s.status, s.relation === 'owned-verified' ? true : null);
          const target =
            s.relation === 'owned-unverified' || s.relation === 'owned-verified'
              ? caller.reincarnationId
              : s.relation === 'sample'
                ? await sampleReincarnationId(sandbox)
                : s.relation === 'foreign'
                  ? (await ownedReincarnation(sandbox, s.status)).reincarnationId
                  : randomUUID();
          const before = s.relation === 'missing' ? null : await storedRow(sandbox, target);

          const valid =
            s.passed !== null &&
            s.totalRuns !== null &&
            s.executionTimeMs !== null &&
            s.executionTimeMs >= 0 &&
            s.totalRuns <= 1_000 &&
            s.totalRuns >= (s.passed ? 100 : 1);
          const attempt = await sandbox.as('authenticated', caller.userId, RECORD, [target, s.passed, s.totalRuns, s.executionTimeMs]);
          const after = s.relation === 'missing' ? null : await storedRow(sandbox, target);

          if (!valid) return !attempt.ok && attempt.code === '22023' && JSON.stringify(after) === JSON.stringify(before);

          const recorded = recordedOf(attempt);
          if (s.relation !== 'owned-unverified') return !recorded.wasUpdated && JSON.stringify(after) === JSON.stringify(before);

          const terminal = s.status === 'RESURRECTED' || s.status === 'FAILED';
          const expectedStatus = terminal ? s.status : s.passed ? 'RESURRECTED' : 'FAILED';
          const second = recordedOf(await sandbox.as('authenticated', caller.userId, RECORD, [target, !s.passed, 500, 1]));
          return (
            recorded.wasUpdated &&
            recorded.passed === s.passed &&
            recorded.totalRuns === s.totalRuns &&
            recorded.executionTimeMs === s.executionTimeMs &&
            recorded.corpseStatus === expectedStatus &&
            JSON.stringify(after) === JSON.stringify({ passed: s.passed, totalRuns: s.totalRuns, executionTimeMs: s.executionTimeMs, status: expectedStatus }) &&
            !second.wasUpdated &&
            JSON.stringify(await storedRow(sandbox, target)) === JSON.stringify(after)
          );
        });
      }),
      { numRuns: 100 },
    );
  }, 300_000);
});
