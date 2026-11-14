// Verification_Suite: migration V3 (05-llm-pipeline-api, Requirement 18). Skipped when TEST_DATABASE_URL is unset.
// Covers the usage ledger, public.reserve_llm_call, public.replace_corpse_curses, and the one-result unique indexes.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabaseUrl } from './support/env.ts';
import { closePool, createWorld, dbDescribe, destroyWorld, getPool, inSandbox, type Attempt, type Sandbox, type World } from './support/db.ts';

const MIGRATIONS = new URL('../migrations/', import.meta.url);

const RESERVE =
  'SELECT allowed, denied_by, retry_after_seconds FROM public.reserve_llm_call($1, $2, $3::interval, $4, $5::interval)';
const REPLACE = 'SELECT public.replace_corpse_curses($1::uuid, $2::jsonb) AS inserted';

interface Verdict {
  allowed: boolean;
  deniedBy: string;
  retryAfterSeconds: number;
}

interface Limits {
  route?: string;
  userLimit?: number;
  userWindowSeconds?: number;
  globalLimit?: number;
  globalWindowSeconds?: number;
}

const reserveArgs = (limits: Limits = {}) => [
  limits.route ?? 'seance',
  limits.userLimit ?? 20,
  `${limits.userWindowSeconds ?? 3_600} seconds`,
  limits.globalLimit ?? 500,
  `${limits.globalWindowSeconds ?? 86_400} seconds`,
];

function verdictOf(attempt: Attempt): Verdict {
  expect(attempt.ok, attempt.ok ? '' : attempt.message).toBe(true);
  if (!attempt.ok) throw new Error(attempt.message);
  const row = attempt.rows[0] ?? {};
  return { allowed: row['allowed'] as boolean, deniedBy: row['denied_by'] as string, retryAfterSeconds: row['retry_after_seconds'] as number };
}

async function createUser(sandbox: Sandbox): Promise<string> {
  const id = randomUUID();
  await sandbox.admin('INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)', [id, `ledger-${id}@example.test`, '{}']);
  return id;
}

/**
 * The global limit counts the rows of all users, including rows that other tests committed (the concurrency test does).
 * Emptying the ledger inside the sandbox transaction isolates a test from them. The rollback restores everything.
 */
async function isolateLedger(sandbox: Sandbox): Promise<void> {
  await sandbox.admin('DELETE FROM public.llm_usage_events');
}

async function ledgerCount(sandbox: Sandbox, userId?: string): Promise<number> {
  const rows = userId
    ? await sandbox.admin('SELECT count(*)::int AS n FROM public.llm_usage_events WHERE user_id = $1', [userId])
    : await sandbox.admin('SELECT count(*)::int AS n FROM public.llm_usage_events');
  return Number(rows[0]?.['n']);
}

function expectCode(attempt: Attempt, code: string): void {
  expect(attempt.ok, 'statement should have been rejected').toBe(false);
  if (!attempt.ok) expect(attempt.code, attempt.message).toBe(code);
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

dbDescribe('R18 migration V3: privileges and structure (Requirement 18)', () => {
  it('R18.1 R18.2 creates the ledger with RLS enabled, no policy, and the documented columns and indexes (Requirement 18)', async () => {
    await inSandbox(async (sandbox) => {
      const columns = await sandbox.admin(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'llm_usage_events' ORDER BY column_name`,
      );
      expect(columns.map((c) => [c['column_name'], c['data_type'], c['is_nullable']])).toEqual([
        ['created_at', 'timestamp with time zone', 'NO'],
        ['id', 'uuid', 'NO'],
        ['route', 'text', 'NO'],
        ['user_id', 'uuid', 'NO'],
      ]);
      const rls = await sandbox.admin("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.llm_usage_events'::regclass");
      expect(rls[0]?.['relrowsecurity']).toBe(true);
      const policies = await sandbox.admin("SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'llm_usage_events'");
      expect(policies[0]?.['n']).toBe(0);
      const indexes = await sandbox.admin("SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'llm_usage_events'");
      const defs = indexes.map((i) => String(i['indexdef']));
      expect(defs.some((d) => d.includes('(user_id, created_at)'))).toBe(true);
      expect(defs.some((d) => /\(created_at\)$/.test(d))).toBe(true);
      const check = await sandbox.admin("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'llm_usage_events_route_check'");
      expect(String(check[0]?.['def'])).toMatch(/seance.*reincarnate/);
    });
  });

  it('R18.2 R18.4 R18.6 anon can neither touch the ledger nor execute the new functions (Requirement 18)', async () => {
    await inSandbox(async (sandbox) => {
      for (const sql of [
        'SELECT * FROM public.llm_usage_events',
        "INSERT INTO public.llm_usage_events (user_id, route) VALUES (gen_random_uuid(), 'seance')",
        "UPDATE public.llm_usage_events SET route = 'seance'",
        'DELETE FROM public.llm_usage_events',
      ]) {
        expectCode(await sandbox.as('anon', null, sql), '42501');
      }
      expectCode(await sandbox.as('anon', null, RESERVE, reserveArgs()), '42501');
      expectCode(await sandbox.as('anon', null, REPLACE, [randomUUID(), '[]']), '42501');
    });
  });

  it('R18.2 R18.10 authenticated can neither select, insert, update, nor delete ledger rows directly (Requirement 18)', async () => {
    await inSandbox(async (sandbox) => {
      const userId = await createUser(sandbox);
      verdictOf(await sandbox.as('authenticated', userId, RESERVE, reserveArgs()));
      expect(await ledgerCount(sandbox, userId)).toBe(1);
      for (const sql of [
        'SELECT * FROM public.llm_usage_events',
        `INSERT INTO public.llm_usage_events (user_id, route) VALUES ('${userId}', 'seance')`,
        "UPDATE public.llm_usage_events SET route = 'reincarnate'",
        'DELETE FROM public.llm_usage_events',
      ]) {
        expectCode(await sandbox.as('authenticated', userId, sql), '42501');
      }
      expect(await ledgerCount(sandbox, userId)).toBe(1);
    });
  });

  it('R18.4 grants EXECUTE on both functions to authenticated only among the API roles (Requirement 18)', async () => {
    await inSandbox(async (sandbox) => {
      const rows = await sandbox.admin(
        `SELECT
           has_function_privilege('anon', 'public.reserve_llm_call(text, integer, interval, integer, interval)', 'EXECUTE') AS anon_reserve,
           has_function_privilege('authenticated', 'public.reserve_llm_call(text, integer, interval, integer, interval)', 'EXECUTE') AS auth_reserve,
           has_function_privilege('anon', 'public.replace_corpse_curses(uuid, jsonb)', 'EXECUTE') AS anon_replace,
           has_function_privilege('authenticated', 'public.replace_corpse_curses(uuid, jsonb)', 'EXECUTE') AS auth_replace`,
      );
      expect(rows[0]).toEqual({ anon_reserve: false, auth_reserve: true, anon_replace: false, auth_replace: true });
    });
  });

  it('R18.3 R18.6 declares the security mode and a fixed search_path for both functions (Requirement 18)', async () => {
    await inSandbox(async (sandbox) => {
      const rows = await sandbox.admin(
        `SELECT proname, prosecdef, proconfig FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace AND proname IN ('reserve_llm_call', 'replace_corpse_curses') ORDER BY proname`,
      );
      expect(rows.map((r) => [r['proname'], r['prosecdef'], String(r['proconfig'])])).toEqual([
        ['replace_corpse_curses', false, 'search_path=""'],
        ['reserve_llm_call', true, 'search_path=""'],
      ]);
    });
  });

  it('R18.7 applies to the seeded database, which keeps one Seance spec and one reincarnation per sample (Requirement 18)', async () => {
    await inSandbox(async (sandbox) => {
      const rows = await sandbox.admin(
        `SELECT c.id,
                (SELECT count(*)::int FROM public.seance_specs s WHERE s.corpse_id = c.id) AS seances,
                (SELECT count(*)::int FROM public.reincarnations r WHERE r.corpse_id = c.id) AS reincarnations
         FROM public.corpses c WHERE c.is_sample`,
      );
      expect(rows.length).toBe(3);
      for (const row of rows) expect([row['seances'], row['reincarnations']]).toEqual([1, 1]);
      const history = await sandbox.admin('SELECT version FROM public.flyway_schema_history WHERE success ORDER BY installed_rank');
      expect(history.map((h) => h['version'])).toEqual(['1', '2', '3']);
    });
  });

  it('R18.9 leaves the V1 and V2 files unchanged (Requirement 18)', () => {
    const digest = (name: string) => createHash('sha256').update(readFileSync(new URL(name, MIGRATIONS), 'utf8').replaceAll('\r\n', '\n'), 'utf8').digest('hex');
    expect(digest('V1__create_lazarus_schema.sql')).toBe('59706299df335fc4292db6a0284054fa6d498b8f660d1fcd585bae3725378502');
    expect(digest('V2__seed_sample_corpses.sql')).toBe('85e280401c43fdbf839916670420008b0f3ca290dbfb899afe25cc73b5e37621');
  });
});

dbDescribe('R8 reserve_llm_call (Requirements 8 and 18)', () => {
  it('R8.2 R18.11 R18.12 allows 20 reservations in 60 minutes and denies the 21st with limit user and retry-after from 1 to 3,600 (Requirement 8)', async () => {
    await inSandbox(async (sandbox) => {
      const userId = await createUser(sandbox);
      for (let n = 1; n <= 20; n++) {
        expect(verdictOf(await sandbox.as('authenticated', userId, RESERVE, reserveArgs())), `call ${n}`).toEqual({ allowed: true, deniedBy: 'none', retryAfterSeconds: 0 });
      }
      const denied = verdictOf(await sandbox.as('authenticated', userId, RESERVE, reserveArgs()));
      expect(denied.allowed).toBe(false);
      expect(denied.deniedBy).toBe('user');
      expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(denied.retryAfterSeconds).toBeLessThanOrEqual(3_600);
      expect(await ledgerCount(sandbox, userId)).toBe(20);
    });
  });

  it('R8.5 a denied call inserts no row (Requirement 8)', async () => {
    await inSandbox(async (sandbox) => {
      const userId = await createUser(sandbox);
      verdictOf(await sandbox.as('authenticated', userId, RESERVE, reserveArgs({ userLimit: 1 })));
      const before = await ledgerCount(sandbox);
      for (let n = 0; n < 3; n++) expect(verdictOf(await sandbox.as('authenticated', userId, RESERVE, reserveArgs({ userLimit: 1 }))).allowed).toBe(false);
      expect(await ledgerCount(sandbox)).toBe(before);
    });
  });

  it('R8.2 reservations of one user do not count for another user (Requirement 8)', async () => {
    await inSandbox(async (sandbox) => {
      const [a, b] = [await createUser(sandbox), await createUser(sandbox)];
      for (let n = 0; n < 2; n++) verdictOf(await sandbox.as('authenticated', a, RESERVE, reserveArgs({ userLimit: 2 })));
      expect(verdictOf(await sandbox.as('authenticated', a, RESERVE, reserveArgs({ userLimit: 2 }))).allowed).toBe(false);
      expect(verdictOf(await sandbox.as('authenticated', b, RESERVE, reserveArgs({ userLimit: 2 }))).allowed).toBe(true);
    });
  });

  it('R8.2 the global limit denies with limit global when the calling user is under their own limit (Requirement 8)', async () => {
    await inSandbox(async (sandbox) => {
      await isolateLedger(sandbox);
      const users = [await createUser(sandbox), await createUser(sandbox), await createUser(sandbox), await createUser(sandbox)];
      for (const userId of users.slice(0, 3)) {
        expect(verdictOf(await sandbox.as('authenticated', userId, RESERVE, reserveArgs({ globalLimit: 3 }))).allowed).toBe(true);
      }
      const denied = verdictOf(await sandbox.as('authenticated', users[3]!, RESERVE, reserveArgs({ globalLimit: 3 })));
      expect(denied.allowed).toBe(false);
      expect(denied.deniedBy).toBe('global');
      expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(denied.retryAfterSeconds).toBeLessThanOrEqual(86_400);
    });
  });

  it('R8.5 reports limit user when both limits are reached, and the larger retry-after (Requirement 8)', async () => {
    await inSandbox(async (sandbox) => {
      await isolateLedger(sandbox);
      const userId = await createUser(sandbox);
      await sandbox.admin(
        `INSERT INTO public.llm_usage_events (user_id, route, created_at)
         VALUES ($1, 'seance', clock_timestamp() - interval '10 seconds')`,
        [userId],
      );
      const verdict = verdictOf(await sandbox.as('authenticated', userId, RESERVE, reserveArgs({ userLimit: 1, userWindowSeconds: 60, globalLimit: 1, globalWindowSeconds: 3_600 })));
      expect(verdict.allowed).toBe(false);
      expect(verdict.deniedBy).toBe('user');
      // The global window frees a slot later (3,590 s) than the user window (50 s), so the larger value is reported.
      expect(verdict.retryAfterSeconds).toBe(3_590);
    });
  });

  it('R8.9 deletes ledger rows older than 24 hours on a valid call and keeps younger rows (Requirement 8)', async () => {
    await inSandbox(async (sandbox) => {
      const userId = await createUser(sandbox);
      await sandbox.admin(
        `INSERT INTO public.llm_usage_events (user_id, route, created_at) VALUES
           ($1, 'seance', clock_timestamp() - interval '25 hours'),
           ($1, 'seance', clock_timestamp() - interval '23 hours 59 minutes'),
           ($1, 'reincarnate', clock_timestamp() - interval '1 minute')`,
        [userId],
      );
      verdictOf(await sandbox.as('authenticated', userId, RESERVE, reserveArgs()));
      expect(await ledgerCount(sandbox, userId)).toBe(3);
      // A denied call also cleans up.
      await sandbox.admin(`INSERT INTO public.llm_usage_events (user_id, route, created_at) VALUES ($1, 'seance', clock_timestamp() - interval '30 hours')`, [userId]);
      expect(verdictOf(await sandbox.as('authenticated', userId, RESERVE, reserveArgs({ userLimit: 1 }))).allowed).toBe(false);
      expect(await ledgerCount(sandbox, userId)).toBe(3);
    });
  });

  it('R8.12 R8.13 R18.5 raises on invalid arguments and a missing user, and changes nothing (Requirement 8)', async () => {
    await inSandbox(async (sandbox) => {
      const userId = await createUser(sandbox);
      await sandbox.admin(`INSERT INTO public.llm_usage_events (user_id, route, created_at) VALUES ($1, 'seance', clock_timestamp() - interval '30 hours')`, [userId]);
      const before = await ledgerCount(sandbox);
      const valid = reserveArgs();
      const invalid: unknown[][] = [
        ['other', valid[1], valid[2], valid[3], valid[4]],
        [null, valid[1], valid[2], valid[3], valid[4]],
        [valid[0], 0, valid[2], valid[3], valid[4]],
        [valid[0], null, valid[2], valid[3], valid[4]],
        [valid[0], valid[1], '0 seconds', valid[3], valid[4]],
        [valid[0], valid[1], null, valid[3], valid[4]],
        [valid[0], valid[1], valid[2], -1, valid[4]],
        [valid[0], valid[1], valid[2], valid[3], '-5 minutes'],
        [valid[0], valid[1], valid[2], valid[3], null],
      ];
      for (const args of invalid) expectCode(await sandbox.as('authenticated', userId, RESERVE, args), '22023');
      expectCode(await sandbox.as('authenticated', null, RESERVE, valid), '28000');
      // The 30-hour-old row is still there, so no cleanup ran, and no row was inserted.
      expect(await ledgerCount(sandbox)).toBe(before);
    });
  });

  it('R8.4 R18.10 25 concurrent reservations by one user in 60 minutes yield exactly 20 allowed results (Requirement 8)', async () => {
    const userId = randomUUID();
    extraUserIds.push(userId);
    await getPool().query('INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)', [userId, `concurrent-${userId}@example.test`, '{}']);
    const pool = new pg.Pool({ connectionString: testDatabaseUrl(), max: 25 });
    try {
      const results = await Promise.all(
        Array.from({ length: 25 }, async () => {
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
      expect(results.filter(Boolean)).toHaveLength(20);
      const stored = await getPool().query('SELECT count(*)::int AS n FROM public.llm_usage_events WHERE user_id = $1', [userId]);
      expect(stored.rows[0]?.n).toBe(20);
    } finally {
      await pool.end();
    }
  });
});

dbDescribe('R5 R7 curse replacement and one-result indexes (Requirements 5, 7, 11, 14, and 18)', () => {
  const curse = (n: number, line = n) => ({
    curse_type: 'VAR_HOISTING',
    severity: 'HEX',
    line_number: line,
    description: `description ${n}`,
    exorcism_strategy: `strategy ${n}`,
  });

  async function ownedCorpse(sandbox: Sandbox): Promise<{ userId: string; corpseId: string }> {
    const userId = await createUser(sandbox);
    const corpseId = randomUUID();
    await sandbox.admin(
      `INSERT INTO public.corpses (id, user_id, is_sample, title, source_language, original_code, code_hash)
       VALUES ($1, $2, false, 'Ledger test corpse', 'es5-jquery', 'function f(){return 1;}', 'hash')`,
      [corpseId, userId],
    );
    await sandbox.admin(
      `INSERT INTO public.curses (corpse_id, curse_type, severity, line_number, description, exorcism_strategy)
       VALUES ($1, 'EVAL_INJECTION', 'FATAL', 1, 'old', 'old'), ($1, 'EVAL_INJECTION', 'FATAL', 2, 'old', 'old')`,
      [corpseId],
    );
    return { userId, corpseId };
  }
  const descriptions = async (sandbox: Sandbox, corpseId: string) =>
    (await sandbox.admin('SELECT description FROM public.curses WHERE corpse_id = $1 ORDER BY description', [corpseId])).map((r) => String(r['description']));

  it('R18.6 replaces the curses of an owned corpse with the given set, and with an empty set (Requirement 18)', async () => {
    await inSandbox(async (sandbox) => {
      const { userId, corpseId } = await ownedCorpse(sandbox);
      const replaced = await sandbox.as('authenticated', userId, REPLACE, [corpseId, JSON.stringify([curse(1), curse(2), curse(3)])]);
      expect(replaced.ok && replaced.rows[0]?.['inserted']).toBe(3);
      expect(await descriptions(sandbox, corpseId)).toEqual(['description 1', 'description 2', 'description 3']);
      const emptied = await sandbox.as('authenticated', userId, REPLACE, [corpseId, '[]']);
      expect(emptied.ok && emptied.rows[0]?.['inserted']).toBe(0);
      expect(await descriptions(sandbox, corpseId)).toEqual([]);
    });
  });

  it('R18.13 raises and leaves the rows unchanged for a corpse of another user, a sample, a missing id, and a non-array (Requirement 18)', async () => {
    await inSandbox(async (sandbox) => {
      const mine = await ownedCorpse(sandbox);
      const other = await ownedCorpse(sandbox);
      const sample = String((await sandbox.admin('SELECT id FROM public.corpses WHERE is_sample ORDER BY title LIMIT 1'))[0]?.['id']);
      const sampleBefore = await sandbox.admin('SELECT count(*)::int AS n FROM public.curses WHERE corpse_id = $1', [sample]);
      const payload = JSON.stringify([curse(9)]);

      expectCode(await sandbox.as('authenticated', mine.userId, REPLACE, [other.corpseId, payload]), '42501');
      expectCode(await sandbox.as('authenticated', mine.userId, REPLACE, [sample, payload]), '42501');
      expectCode(await sandbox.as('authenticated', mine.userId, REPLACE, [randomUUID(), payload]), '42501');
      for (const notArray of ['{}', 'null', '"text"', '7']) {
        expectCode(await sandbox.as('authenticated', mine.userId, REPLACE, [mine.corpseId, notArray]), '22023');
      }
      expectCode(await sandbox.as('authenticated', mine.userId, 'SELECT public.replace_corpse_curses(NULL, $1::jsonb)', ['[]']), '22023');

      expect(await descriptions(sandbox, other.corpseId)).toEqual(['old', 'old']);
      expect(await descriptions(sandbox, mine.corpseId)).toEqual(['old', 'old']);
      expect(await sandbox.admin('SELECT count(*)::int AS n FROM public.curses WHERE corpse_id = $1', [sample])).toEqual(sampleBefore);
    });
  });

  it('R5.9 R18.6 keeps the previous rows when one element is invalid, because the replacement is one transaction (Requirement 5)', async () => {
    await inSandbox(async (sandbox) => {
      const { userId, corpseId } = await ownedCorpse(sandbox);
      const bad = [curse(1), { curse_type: 'NOT_A_CURSE', severity: 'HEX', line_number: 1, description: 'd', exorcism_strategy: 's' }];
      expect((await sandbox.as('authenticated', userId, REPLACE, [corpseId, JSON.stringify(bad)])).ok).toBe(false);
      expect((await sandbox.as('authenticated', userId, REPLACE, [corpseId, JSON.stringify([{}])])).ok).toBe(false);
      expect(await descriptions(sandbox, corpseId)).toEqual(['old', 'old']);
    });
  });

  it('R18.10 two concurrent replacements of one corpse leave one complete set (Requirement 5)', async () => {
    const userId = world!.a.userId;
    const corpseId = world!.a.corpseId;
    const pool = new pg.Pool({ connectionString: testDatabaseUrl(), max: 4 });
    const replaceWith = async (label: string, count: number) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE authenticated');
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
        const set = Array.from({ length: count }, (_, n) => ({ ...curse(n + 1), description: `${label} ${n + 1}` }));
        await client.query(REPLACE, [corpseId, JSON.stringify(set)]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    };
    try {
      for (let round = 0; round < 5; round++) {
        await Promise.all([replaceWith('A', 2), replaceWith('B', 3)]);
        const rows = await getPool().query<{ description: string }>('SELECT description FROM public.curses WHERE corpse_id = $1 ORDER BY description', [corpseId]);
        const labels = new Set(rows.rows.map((r) => r.description.split(' ')[0]));
        expect(labels.size, `round ${round}`).toBe(1);
        expect(rows.rows.length).toBe(labels.has('A') ? 2 : 3);
      }
    } finally {
      await pool.end();
    }
  });

  it('R18.7 R11.8 R14.3 rejects a second Seance spec or reincarnation for one corpse, but allows one per corpse (Requirement 18)', async () => {
    await inSandbox(async (sandbox) => {
      const { userId, corpseId } = await ownedCorpse(sandbox);
      const other = await ownedCorpse(sandbox);
      const insertSeance = "INSERT INTO public.seance_specs (corpse_id, requirements_md, design_md, invariants_json) VALUES ($1, 'r', 'd', '{}'::jsonb)";
      const insertReincarnation = "INSERT INTO public.reincarnations (corpse_id, target_stack, modern_code, pbt_test_code) VALUES ($1, 'TypeScript', 'c', 't')";
      for (const sql of [insertSeance, insertReincarnation]) {
        expect((await sandbox.as('authenticated', userId, sql, [corpseId])).ok).toBe(true);
        expectCode(await sandbox.as('authenticated', userId, sql, [corpseId]), '23505');
        expect((await sandbox.as('authenticated', other.userId, sql, [other.corpseId])).ok).toBe(true);
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Property 22: reserve_llm_call matches a rolling-window model
// The model works on absolute instants read from the database clock. A call runs between two clock readings, so the
// verdict must agree with the model evaluated at the start or at the end of that interval. This keeps the test exact
// when the machine is slow, because real time keeps passing while the function runs.
// ---------------------------------------------------------------------------------------------

interface ModelRow {
  id: string;
  user: number;
  /** Creation instant in milliseconds since the epoch, as stored by the database. */
  ms: number;
}
interface ModelLimits {
  userLimit: number;
  userWindow: number;
  globalLimit: number;
  globalWindow: number;
}
interface ModelVerdict {
  allowed: boolean;
  deniedBy: 'none' | 'user' | 'global';
  retryAfterSeconds: number;
}

const DAY = 86_400;
const clampRetry = (seconds: number) => Math.min(DAY, Math.max(1, seconds));

/** The verdict a call would get at the instant `nowMs`. It never changes the rows. */
function modelVerdictAt(rows: ModelRow[], user: number, limits: ModelLimits, nowMs: number): ModelVerdict {
  const retryFor = (counted: ModelRow[], limit: number, windowSeconds: number): number => {
    if (counted.length < limit) return 0;
    const oldestFirst = [...counted].sort((a, b) => a.ms - b.ms);
    const leaves = oldestFirst[counted.length - limit]!.ms + windowSeconds * 1_000;
    return clampRetry(Math.ceil((leaves - nowMs) / 1_000));
  };
  const userRetry = retryFor(rows.filter((r) => r.user === user && r.ms > nowMs - limits.userWindow * 1_000), limits.userLimit, limits.userWindow);
  const globalRetry = retryFor(rows.filter((r) => r.ms > nowMs - limits.globalWindow * 1_000), limits.globalLimit, limits.globalWindow);
  if (userRetry > 0 || globalRetry > 0) {
    return { allowed: false, deniedBy: userRetry > 0 ? 'user' : 'global', retryAfterSeconds: Math.max(userRetry, globalRetry) };
  }
  return { allowed: true, deniedBy: 'none', retryAfterSeconds: 0 };
}

const scenario = fc.record({
  userLimit: fc.integer({ min: 1, max: 30 }),
  globalLimit: fc.integer({ min: 1, max: 30 }),
  userWindow: fc.integer({ min: 60, max: DAY }),
  globalWindow: fc.integer({ min: 60, max: DAY }),
  seeded: fc.array(fc.record({ user: fc.integer({ min: 0, max: 2 }), age: fc.integer({ min: 0, max: DAY + 3_600 }) }), { maxLength: 40 }),
  calls: fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 1, maxLength: 6 }),
});

dbDescribe('R8 R18 quota function against a rolling-window model (Requirements 8 and 18)', () => {
  it('R8.2 R8.9 R18.11 R18.12 allows, denies, and reports retry-after like the model, and cleans up like the model (Requirement 8)', async () => {
    // Feature: 05-llm-pipeline-api, Property 22: Quota function matches a rolling-window model (database)
    await fc.assert(
      fc.asyncProperty(scenario, async (input) => {
        await inSandbox(async (sandbox) => {
          await isolateLedger(sandbox);
          const users = [await createUser(sandbox), await createUser(sandbox), await createUser(sandbox)];
          const clockMs = async () => Number((await sandbox.admin("SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS ms"))[0]?.['ms']);
          const readLedger = async (): Promise<ModelRow[]> =>
            (await sandbox.admin('SELECT id, user_id, (extract(epoch FROM created_at) * 1000)::float8 AS ms FROM public.llm_usage_events')).map((row) => ({
              id: String(row['id']),
              user: users.indexOf(String(row['user_id'])),
              ms: Number(row['ms']),
            }));

          if (input.seeded.length > 0) {
            const base = await clockMs();
            await sandbox.admin(
              `INSERT INTO public.llm_usage_events (user_id, route, created_at)
               SELECT u, 'seance', to_timestamp(($3::float8 - a * 1000.0) / 1000.0)
               FROM unnest($1::uuid[], $2::int[]) AS t(u, a)`,
              [input.seeded.map((row) => users[row.user]), input.seeded.map((row) => row.age), base],
            );
          }
          // The model starts from what the database really stored, so rounding of the seeded instants cannot matter.
          let ledger = await readLedger();
          const limits: ModelLimits = { userLimit: input.userLimit, userWindow: input.userWindow, globalLimit: input.globalLimit, globalWindow: input.globalWindow };

          for (const caller of input.calls) {
            const t0 = await clockMs();
            const actual = verdictOf(
              await sandbox.as('authenticated', users[caller]!, RESERVE, reserveArgs({ userLimit: limits.userLimit, userWindowSeconds: limits.userWindow, globalLimit: limits.globalLimit, globalWindowSeconds: limits.globalWindow })),
            );
            const t1 = await clockMs();
            // The model assumes the database clock never moves backwards while a call runs. The clock of a virtual machine
            // can (Docker Desktop does so after the host sleeps), and no model is exact against it. Such a case is discarded
            // and its transaction is rolled back, so it proves nothing either way.
            fc.pre(t1 >= t0);

            // The function read the clock somewhere in [t0, t1]. When the model gives one verdict at both ends, that is the verdict.
            const atStart = modelVerdictAt(ledger, caller, limits, t0);
            const atEnd = modelVerdictAt(ledger, caller, limits, t1);
            if (atStart.allowed === atEnd.allowed && atStart.deniedBy === atEnd.deniedBy) {
              expect({ allowed: actual.allowed, deniedBy: actual.deniedBy }).toEqual({ allowed: atStart.allowed, deniedBy: atStart.deniedBy });
              if (!actual.allowed) {
                // The time until a slot frees only shrinks as time passes, so it lies between the two readings (one second of rounding allowed).
                expect(actual.retryAfterSeconds).toBeGreaterThanOrEqual(Math.max(1, atEnd.retryAfterSeconds - 1));
                expect(actual.retryAfterSeconds).toBeLessThanOrEqual(Math.min(DAY, atStart.retryAfterSeconds + 1));
              } else {
                expect(actual.retryAfterSeconds).toBe(0);
              }
            }

            // Reconcile with what the database stored. A denied call adds nothing, and an allowed call adds exactly one row.
            const after = await readLedger();
            const known = new Set(ledger.map((row) => row.id));
            const added = after.filter((row) => !known.has(row.id));
            expect(added.length, 'rows added by the call').toBe(actual.allowed ? 1 : 0);
            if (actual.allowed) {
              expect(added[0]!.user).toBe(caller);
              // The row is stamped by the database clock while the function runs, between the two readings.
              expect(added[0]!.ms).toBeGreaterThanOrEqual(t0 - 1);
              expect(added[0]!.ms).toBeLessThanOrEqual(t1 + 1);
            }
            const remaining = new Set(after.map((row) => row.id));
            for (const row of ledger) {
              const removed = !remaining.has(row.id);
              // Older than 24 hours before the call began: must be gone. Younger than 24 hours at the end: must stay.
              if (t0 - row.ms > DAY * 1_000) expect(removed, `row older than 24 hours at ${t0 - row.ms} ms`).toBe(true);
              if (t1 - row.ms < DAY * 1_000) expect(removed, `row younger than 24 hours at ${t1 - row.ms} ms`).toBe(false);
            }
            ledger = after;
          }

          // One user's rows never count for another: the stored rows per user match the model's.
          const perUser = await readLedger();
          for (const index of [0, 1, 2]) expect(perUser.filter((row) => row.user === index).length).toBe(ledger.filter((row) => row.user === index).length);
        });
      }),
      { numRuns: 100 },
    );
  });
});
