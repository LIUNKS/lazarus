// Verification_Suite: Row Level Security and privileges (Requirements 12 to 15, 16.5, and 16.6).
// Statements run as the anon and authenticated roles with two simulated users, A and B.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  CHILD_TABLES,
  LAZARUS_TABLES,
  closePool,
  createWorld,
  dbDescribe,
  destroyWorld,
  getPool,
  inSandbox,
  type Attempt,
  type Sandbox,
  type UserWorld,
  type World,
} from './support/db.ts';

let world: World;

beforeAll(async () => {
  // Skipped suites never run hooks; the pool throws a clear message when the database is unreachable.
  if (process.env['TEST_DATABASE_URL']) world = await createWorld();
});

afterAll(async () => {
  if (world) await destroyWorld(world);
  await closePool();
});

const CHILD = {
  curses: {
    insert:
      "INSERT INTO public.curses (corpse_id, curse_type, severity, line_number, description, exorcism_strategy) VALUES ($1, 'VAR_HOISTING', 'HEX', 1, 'd', 's')",
    set: "description = 'changed by suite'",
  },
  seance_specs: {
    insert: "INSERT INTO public.seance_specs (corpse_id, requirements_md, design_md, invariants_json) VALUES ($1, 'r', 'd', '{}'::jsonb)",
    set: "design_md = 'changed by suite'",
  },
  reincarnations: {
    insert: "INSERT INTO public.reincarnations (corpse_id, target_stack, modern_code, pbt_test_code) VALUES ($1, 'TypeScript', 'c', 't')",
    set: "target_stack = 'changed by suite'",
  },
} as const;

type ChildTable = keyof typeof CHILD;
const CHILD_KEYS = Object.keys(CHILD) as ChildTable[];
// Tables that hold at most one row per corpse since migration V3 (a unique index on corpse_id).
const ONE_RESULT_PER_CORPSE: ReadonlySet<ChildTable> = new Set<ChildTable>(['seance_specs', 'reincarnations']);

const ALL_ROWS_DIGEST = `
  SELECT md5(coalesce(string_agg(t, '|' ORDER BY t), '')) AS digest FROM (
    SELECT p::text AS t FROM public.profiles p
    UNION ALL SELECT c::text FROM public.corpses c
    UNION ALL SELECT x::text FROM public.curses x
    UNION ALL SELECT x::text FROM public.seance_specs x
    UNION ALL SELECT x::text FROM public.reincarnations x
  ) s`;

async function digest(sandbox: Sandbox): Promise<string> {
  return String((await sandbox.admin(ALL_ROWS_DIGEST))[0]?.['digest']);
}

function expectDenied(attempt: Attempt, code = '42501'): void {
  expect(attempt.ok, 'statement should have been rejected').toBe(false);
  if (!attempt.ok) expect(attempt.code).toBe(code);
}

function expectRows(attempt: Attempt): Record<string, unknown>[] {
  expect(attempt.ok, attempt.ok ? '' : attempt.message).toBe(true);
  return attempt.ok ? attempt.rows : [];
}

function expectAffected(attempt: Attempt, count: number): void {
  expect(attempt.ok, attempt.ok ? '' : attempt.message).toBe(true);
  if (attempt.ok) expect(attempt.rowCount).toBe(count);
}

async function policies(table: string, command: string): Promise<Array<{ qual: string; check: string; roles: string }>> {
  const result = await getPool().query(
    "SELECT coalesce(qual, '') AS qual, coalesce(with_check, '') AS check, roles::text AS roles FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 AND cmd = $2",
    [table, command],
  );
  return result.rows as Array<{ qual: string; check: string; roles: string }>;
}

dbDescribe('R12 RLS enablement and anonymous write denial', () => {
  it('R12.1 enables row level security on every Lazarus table', async () => {
    const result = await getPool().query(
      "SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1)",
      [[...LAZARUS_TABLES]],
    );
    expect(result.rows).toHaveLength(5);
    for (const row of result.rows) expect(row.relrowsecurity, row.relname).toBe(true);
  });

  it('R12.2 writes the current user id only as (select auth.uid())', async () => {
    const result = await getPool().query(
      "SELECT policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') AS expr FROM pg_policies WHERE schemaname = 'public'",
    );
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      const withoutSubqueries = String(row.expr).replaceAll(/\(\s*SELECT auth\.uid\(\) AS uid\)/gi, '');
      expect(withoutSubqueries, row.policyname).not.toMatch(/auth\.uid\(\)/i);
    }
  });

  it('R12.3 defines no INSERT, UPDATE, DELETE, or ALL policy that applies to anon', async () => {
    const result = await getPool().query(
      `SELECT tablename, policyname FROM pg_policies
       WHERE schemaname = 'public' AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
         AND (roles && ARRAY['anon', 'public']::name[])`,
    );
    expect(result.rows).toEqual([]);
  });

  it('R12.4 grants no INSERT, UPDATE, or DELETE privilege to anon or PUBLIC', async () => {
    for (const table of LAZARUS_TABLES) {
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE']) {
        const granted = await getPool().query("SELECT has_table_privilege('anon', $1, $2) AS ok", [`public.${table}`, privilege]);
        expect(granted.rows[0]?.ok, `${table} ${privilege} for anon`).toBe(false);
      }
      const publicGrants = await getPool().query(
        `SELECT a.privilege_type FROM pg_class c, aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
         WHERE c.oid = $1::regclass AND a.grantee = 0`,
        [`public.${table}`],
      );
      expect(publicGrants.rows, `${table} PUBLIC grants`).toEqual([]);
    }
  });

  it('R12.5 rejects anon INSERT, UPDATE, and DELETE on every table with SQLSTATE 42501', async () => {
    const statements: Record<string, string[]> = {
      profiles: [
        `INSERT INTO public.profiles (id) VALUES ('${randomUUID()}')`,
        "UPDATE public.profiles SET email = 'x'",
        'DELETE FROM public.profiles',
      ],
      corpses: [
        "INSERT INTO public.corpses (is_sample, title, source_language, original_code, code_hash) VALUES (true, 't', 'es3', 'c', 'h')",
        "UPDATE public.corpses SET title = 'x'",
        'DELETE FROM public.corpses',
      ],
      curses: [CHILD.curses.insert.replace('$1', `'${randomUUID()}'`), `UPDATE public.curses SET ${CHILD.curses.set}`, 'DELETE FROM public.curses'],
      seance_specs: [
        CHILD.seance_specs.insert.replace('$1', `'${randomUUID()}'`),
        `UPDATE public.seance_specs SET ${CHILD.seance_specs.set}`,
        'DELETE FROM public.seance_specs',
      ],
      reincarnations: [
        CHILD.reincarnations.insert.replace('$1', `'${randomUUID()}'`),
        `UPDATE public.reincarnations SET ${CHILD.reincarnations.set}`,
        'DELETE FROM public.reincarnations',
      ],
    };
    await inSandbox(async (sandbox) => {
      for (const [table, list] of Object.entries(statements)) {
        for (const sql of list) {
          const before = await digest(sandbox);
          expectDenied(await sandbox.as('anon', null, sql));
          expect(await digest(sandbox), `${table}: ${sql}`).toBe(before);
        }
      }
    });
  });

  it('R12.6 never uses user_id IS NULL in a policy expression', async () => {
    const result = await getPool().query(
      "SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND (coalesce(qual, '') || coalesce(with_check, '')) ~* 'user_id IS NULL'",
    );
    expect(result.rows).toEqual([]);
  });

  it('R12.7 hides flyway_schema_history from anon and authenticated', async () => {
    await inSandbox(async (sandbox) => {
      for (const role of ['anon', 'authenticated'] as const) {
        expectDenied(await sandbox.as(role, world.a.userId, 'SELECT * FROM public.flyway_schema_history'));
      }
    });
  });
});

dbDescribe('R13 corpses policies', () => {
  const insertOwned = (userId: string): string =>
    `INSERT INTO public.corpses (user_id, is_sample, title, source_language, original_code, code_hash)
     VALUES ('${userId}', false, 'new', 'es3', 'c', 'h')`;

  it('R13.1 lets anon and authenticated read sample corpses', async () => {
    await inSandbox(async (sandbox) => {
      for (const [role, user] of [['anon', null], ['authenticated', world.a.userId]] as const) {
        const rows = expectRows(await sandbox.as(role, user, 'SELECT id FROM public.corpses WHERE is_sample'));
        expect(rows.length, role).toBeGreaterThanOrEqual(3);
      }
    });
  });

  it('R13.2 lets a user select, insert, update, and delete their own corpses', async () => {
    await inSandbox(async (sandbox) => {
      const a = world.a.userId;
      expect(expectRows(await sandbox.as('authenticated', a, 'SELECT id FROM public.corpses WHERE id = $1', [world.a.corpseId]))).toHaveLength(1);
      expectAffected(await sandbox.as('authenticated', a, insertOwned(a)), 1);
      expectAffected(await sandbox.as('authenticated', a, "UPDATE public.corpses SET title = 'renamed' WHERE id = $1", [world.a.corpseId]), 1);
      expectAffected(await sandbox.as('authenticated', a, 'DELETE FROM public.corpses WHERE id = $1', [world.a.corpseId]), 1);
    });
  });

  it('R13.3 requires is_sample = false and user_id = the caller in every INSERT and UPDATE WITH CHECK', async () => {
    for (const command of ['INSERT', 'UPDATE']) {
      const rows = await policies('corpses', command);
      expect(rows.length, command).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.check, command).toMatch(/is_sample = false/);
        expect(row.check, command).toMatch(/user_id = \(\s*SELECT auth\.uid\(\) AS uid\)/);
      }
    }
  });

  it('R13.4 returns no non-sample corpse to anon', async () => {
    await inSandbox(async (sandbox) => {
      expect(expectRows(await sandbox.as('anon', null, 'SELECT id FROM public.corpses WHERE NOT is_sample'))).toHaveLength(0);
    });
  });

  it('R13.5 returns no corpse of another user to an authenticated user', async () => {
    await inSandbox(async (sandbox) => {
      const rows = expectRows(await sandbox.as('authenticated', world.a.userId, 'SELECT id FROM public.corpses WHERE id = $1', [world.b.corpseId]));
      expect(rows).toHaveLength(0);
      const visible = expectRows(await sandbox.as('authenticated', world.a.userId, 'SELECT id FROM public.corpses WHERE NOT is_sample AND user_id <> $1', [world.a.userId]));
      expect(visible).toHaveLength(0);
    });
  });

  it('R13.6 rejects inserts of sample rows or rows owned by another user', async () => {
    await inSandbox(async (sandbox) => {
      const a = world.a.userId;
      const before = await digest(sandbox);
      expectDenied(
        await sandbox.as('authenticated', a, "INSERT INTO public.corpses (is_sample, title, source_language, original_code, code_hash) VALUES (true, 't', 'es3', 'c', 'h')"),
      );
      expectDenied(await sandbox.as('authenticated', a, insertOwned(world.b.userId)));
      expect(await digest(sandbox)).toBe(before);
    });
  });

  it('R13.7 updates zero rows for samples and for corpses of another user', async () => {
    await inSandbox(async (sandbox) => {
      const before = await digest(sandbox);
      const sql = "UPDATE public.corpses SET title = 'hijacked' WHERE id = $1";
      expectAffected(await sandbox.as('authenticated', world.a.userId, sql, [world.sampleId]), 0);
      expectAffected(await sandbox.as('authenticated', world.a.userId, sql, [world.b.corpseId]), 0);
      expect(await digest(sandbox)).toBe(before);
    });
  });

  it('R13.8 deletes zero rows for samples and for corpses of another user', async () => {
    await inSandbox(async (sandbox) => {
      const before = await digest(sandbox);
      const sql = 'DELETE FROM public.corpses WHERE id = $1';
      expectAffected(await sandbox.as('authenticated', world.a.userId, sql, [world.sampleId]), 0);
      expectAffected(await sandbox.as('authenticated', world.a.userId, sql, [world.b.corpseId]), 0);
      expect(await digest(sandbox)).toBe(before);
    });
  });

  it('R13.9 rejects updates that hand a corpse to another user or turn it into a sample', async () => {
    await inSandbox(async (sandbox) => {
      const before = await digest(sandbox);
      expectDenied(await sandbox.as('authenticated', world.a.userId, 'UPDATE public.corpses SET user_id = $1 WHERE id = $2', [world.b.userId, world.a.corpseId]));
      expectDenied(await sandbox.as('authenticated', world.a.userId, 'UPDATE public.corpses SET is_sample = true WHERE id = $1', [world.a.corpseId]));
      expect(await digest(sandbox)).toBe(before);
    });
  });

  it('R13.10 rejects anon inserts with SQLSTATE 42501 and inserts zero rows', async () => {
    await inSandbox(async (sandbox) => {
      const before = await digest(sandbox);
      expectDenied(
        await sandbox.as('anon', null, "INSERT INTO public.corpses (is_sample, title, source_language, original_code, code_hash) VALUES (true, 't', 'es3', 'c', 'h')"),
      );
      expect(await digest(sandbox)).toBe(before);
    });
  });

  it('R13.11 rejects anon updates and deletes with SQLSTATE 42501', async () => {
    await inSandbox(async (sandbox) => {
      const before = await digest(sandbox);
      expectDenied(await sandbox.as('anon', null, "UPDATE public.corpses SET title = 'x'"));
      expectDenied(await sandbox.as('anon', null, 'DELETE FROM public.corpses'));
      expect(await digest(sandbox)).toBe(before);
    });
  });
});

dbDescribe('R14 child table policies', () => {
  it('R14.1 lets anon and authenticated read child rows of sample corpses', async () => {
    await inSandbox(async (sandbox) => {
      for (const table of CHILD_KEYS) {
        for (const [role, user] of [['anon', null], ['authenticated', world.a.userId]] as const) {
          const rows = expectRows(await sandbox.as(role, user, `SELECT id FROM public.${table} WHERE corpse_id = $1`, [world.sampleId]));
          expect(rows.length, `${table} ${role}`).toBeGreaterThanOrEqual(1);
        }
      }
    });
  });

  it('R14.2 lets the owner select, insert, update, and delete child rows of their corpse', async () => {
    await inSandbox(async (sandbox) => {
      const a = world.a;
      const update = (table: ChildTable) => `UPDATE public.${table} SET ${CHILD[table].set} WHERE corpse_id = $1`;
      const remove = (table: ChildTable) => `DELETE FROM public.${table} WHERE corpse_id = $1`;
      for (const table of CHILD_KEYS) {
        expect(expectRows(await sandbox.as('authenticated', a.userId, `SELECT id FROM public.${table} WHERE corpse_id = $1`, [a.corpseId])).length).toBeGreaterThanOrEqual(1);
        if (ONE_RESULT_PER_CORPSE.has(table)) {
          // Migration V3 (05-llm-pipeline-api) allows one row per corpse in this table. The corpse already has its row,
          // so a second insert is rejected by the unique index. The owner still holds all four permissions on a single row.
          expectDenied(await sandbox.as('authenticated', a.userId, CHILD[table].insert, [a.corpseId]), '23505');
          expectAffected(await sandbox.as('authenticated', a.userId, update(table), [a.corpseId]), 1);
          expectAffected(await sandbox.as('authenticated', a.userId, remove(table), [a.corpseId]), 1);
          expectAffected(await sandbox.as('authenticated', a.userId, CHILD[table].insert, [a.corpseId]), 1);
          expectAffected(await sandbox.as('authenticated', a.userId, remove(table), [a.corpseId]), 1);
        } else {
          expectAffected(await sandbox.as('authenticated', a.userId, CHILD[table].insert, [a.corpseId]), 1);
          expectAffected(await sandbox.as('authenticated', a.userId, update(table), [a.corpseId]), 2);
          expectAffected(await sandbox.as('authenticated', a.userId, remove(table), [a.corpseId]), 2);
        }
      }
    });
  });

  it('R14.3 repeats the owner EXISTS condition in WITH CHECK (INSERT, UPDATE) and USING (UPDATE, DELETE)', async () => {
    for (const table of CHILD_TABLES) {
      for (const command of ['INSERT', 'UPDATE']) {
        for (const row of await policies(table, command)) {
          expect(row.check, `${table} ${command} WITH CHECK`).toMatch(/EXISTS/);
          expect(row.check, `${table} ${command} WITH CHECK`).toMatch(/user_id = \(\s*SELECT auth\.uid\(\) AS uid\)/);
        }
      }
      for (const command of ['UPDATE', 'DELETE']) {
        for (const row of await policies(table, command)) {
          expect(row.qual, `${table} ${command} USING`).toMatch(/EXISTS/);
          expect(row.qual, `${table} ${command} USING`).toMatch(/user_id = \(\s*SELECT auth\.uid\(\) AS uid\)/);
        }
      }
    }
  });

  it('R14.4 returns zero child rows of non-sample corpses to anon without an error', async () => {
    await inSandbox(async (sandbox) => {
      for (const table of CHILD_KEYS) {
        expect(expectRows(await sandbox.as('anon', null, `SELECT id FROM public.${table} WHERE corpse_id = $1`, [world.b.corpseId]))).toHaveLength(0);
      }
    });
  });

  it('R14.5 returns zero child rows of another user to an authenticated user without an error', async () => {
    await inSandbox(async (sandbox) => {
      for (const table of CHILD_KEYS) {
        expect(expectRows(await sandbox.as('authenticated', world.a.userId, `SELECT id FROM public.${table} WHERE corpse_id = $1`, [world.b.corpseId]))).toHaveLength(0);
      }
    });
  });

  it('R14.6 rejects inserts whose corpse is a sample, belongs to another user, or does not exist', async () => {
    await inSandbox(async (sandbox) => {
      const before = await digest(sandbox);
      for (const table of CHILD_KEYS) {
        for (const corpseId of [world.sampleId, world.b.corpseId, randomUUID()]) {
          expect((await sandbox.as('authenticated', world.a.userId, CHILD[table].insert, [corpseId])).ok, `${table} ${corpseId}`).toBe(false);
        }
      }
      expect(await digest(sandbox)).toBe(before);
    });
  });

  it('R14.7 updates and deletes zero child rows of samples and of other users', async () => {
    await inSandbox(async (sandbox) => {
      const before = await digest(sandbox);
      for (const table of CHILD_KEYS) {
        for (const corpseId of [world.sampleId, world.b.corpseId]) {
          expectAffected(await sandbox.as('authenticated', world.a.userId, `UPDATE public.${table} SET ${CHILD[table].set} WHERE corpse_id = $1`, [corpseId]), 0);
          expectAffected(await sandbox.as('authenticated', world.a.userId, `DELETE FROM public.${table} WHERE corpse_id = $1`, [corpseId]), 0);
        }
      }
      expect(await digest(sandbox)).toBe(before);
    });
  });

  it('R14.8 rejects moving an owned child row to a sample, to another user, or to a missing corpse', async () => {
    await inSandbox(async (sandbox) => {
      const before = await digest(sandbox);
      for (const table of CHILD_KEYS) {
        for (const corpseId of [world.sampleId, world.b.corpseId, randomUUID()]) {
          const attempt = await sandbox.as('authenticated', world.a.userId, `UPDATE public.${table} SET corpse_id = $1 WHERE corpse_id = $2`, [corpseId, world.a.corpseId]);
          expect(attempt.ok, `${table} -> ${corpseId}`).toBe(false);
        }
      }
      expect(await digest(sandbox)).toBe(before);
    });
  });

  it('R14.9 rejects anon inserts on every child table with SQLSTATE 42501', async () => {
    await inSandbox(async (sandbox) => {
      for (const table of CHILD_KEYS) {
        expectDenied(await sandbox.as('anon', null, CHILD[table].insert, [world.sampleId]));
      }
    });
  });

  it('R14.10 rejects anon updates and deletes on every child table with SQLSTATE 42501', async () => {
    await inSandbox(async (sandbox) => {
      const before = await digest(sandbox);
      for (const table of CHILD_KEYS) {
        expectDenied(await sandbox.as('anon', null, `UPDATE public.${table} SET ${CHILD[table].set}`));
        expectDenied(await sandbox.as('anon', null, `DELETE FROM public.${table}`));
      }
      expect(await digest(sandbox)).toBe(before);
    });
  });
});

dbDescribe('R15 profiles policies', () => {
  it('R15.1 lets a user select and update only their own profile through the USING clause', async () => {
    for (const command of ['SELECT', 'UPDATE']) {
      const rows = await policies('profiles', command);
      expect(rows.length, command).toBeGreaterThan(0);
      for (const row of rows) expect(row.qual, command).toMatch(/id = \(\s*SELECT auth\.uid\(\) AS uid\)/);
    }
    await inSandbox(async (sandbox) => {
      expectAffected(await sandbox.as('authenticated', world.a.userId, "UPDATE public.profiles SET github_username = 'renamed' WHERE id = $1", [world.a.userId]), 1);
    });
  });

  it('R15.2 includes id = the caller in the UPDATE WITH CHECK clause', async () => {
    for (const row of await policies('profiles', 'UPDATE')) {
      expect(row.check).toMatch(/id = \(\s*SELECT auth\.uid\(\) AS uid\)/);
    }
  });

  it('R15.3 defines no INSERT or DELETE policy and grants no INSERT or DELETE privilege to API roles', async () => {
    for (const command of ['INSERT', 'DELETE', 'ALL']) {
      expect(await policies('profiles', command), command).toEqual([]);
    }
    for (const role of ['anon', 'authenticated']) {
      for (const privilege of ['INSERT', 'DELETE']) {
        const granted = await getPool().query("SELECT has_table_privilege($1, 'public.profiles', $2) AS ok", [role, privilege]);
        expect(granted.rows[0]?.ok, `${role} ${privilege}`).toBe(false);
      }
    }
    const publicGrants = await getPool().query(
      "SELECT a.privilege_type FROM pg_class c, aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a WHERE c.oid = 'public.profiles'::regclass AND a.grantee = 0",
    );
    expect(publicGrants.rows).toEqual([]);
  });

  it('R15.4 returns zero profile rows to anon without an error', async () => {
    await inSandbox(async (sandbox) => {
      expect(expectRows(await sandbox.as('anon', null, 'SELECT id FROM public.profiles'))).toHaveLength(0);
    });
  });

  it('R15.5 returns exactly the own profile and no other', async () => {
    await inSandbox(async (sandbox) => {
      const own = expectRows(await sandbox.as('authenticated', world.a.userId, 'SELECT id FROM public.profiles WHERE id = ANY($1::uuid[])', [world.userIds]));
      expect(own).toEqual([{ id: world.a.userId }]);
      const other = expectRows(await sandbox.as('authenticated', world.a.userId, 'SELECT id FROM public.profiles WHERE id = $1', [world.b.userId]));
      expect(other).toHaveLength(0);
    });
  });

  it('R15.6 updates zero rows of another user profile and changes nothing', async () => {
    await inSandbox(async (sandbox) => {
      const before = await digest(sandbox);
      expectAffected(await sandbox.as('authenticated', world.a.userId, "UPDATE public.profiles SET github_username = 'hijacked' WHERE id = $1", [world.b.userId]), 0);
      expect(await digest(sandbox)).toBe(before);
    });
  });

  it('R15.7 rejects changing the own profile id', async () => {
    await inSandbox(async (sandbox) => {
      const before = await digest(sandbox);
      expectDenied(await sandbox.as('authenticated', world.a.userId, 'UPDATE public.profiles SET id = $1 WHERE id = $2', [world.b.userId, world.a.userId]));
      expect(await digest(sandbox)).toBe(before);
    });
  });

  it('R15.8 leaves profiles unchanged when an authenticated user tries to insert or delete', async () => {
    await inSandbox(async (sandbox) => {
      const before = await digest(sandbox);
      const insert = await sandbox.as('authenticated', world.a.userId, `INSERT INTO public.profiles (id) VALUES ('${randomUUID()}')`);
      const remove = await sandbox.as('authenticated', world.a.userId, 'DELETE FROM public.profiles WHERE id = $1', [world.a.userId]);
      expect(insert.ok).toBe(false);
      expect(remove.ok).toBe(false);
      expect(await digest(sandbox)).toBe(before);
    });
  });

  it('R15.9 rejects anon inserts, updates, and deletes with SQLSTATE 42501', async () => {
    await inSandbox(async (sandbox) => {
      const before = await digest(sandbox);
      expectDenied(await sandbox.as('anon', null, `INSERT INTO public.profiles (id) VALUES ('${randomUUID()}')`));
      expectDenied(await sandbox.as('anon', null, "UPDATE public.profiles SET email = 'x'"));
      expectDenied(await sandbox.as('anon', null, 'DELETE FROM public.profiles'));
      expect(await digest(sandbox)).toBe(before);
    });
  });
});

dbDescribe('R16 isolation checks in the Verification_Suite', () => {
  it('R16.3 simulates two users whose ids equal the ids of the user rows the suite created', async () => {
    expect(world.a.userId).not.toBe(world.b.userId);
    const rows = await getPool().query('SELECT id FROM auth.users WHERE id = ANY($1::uuid[])', [world.userIds]);
    expect(rows.rows.map((r) => r.id).sort()).toEqual([...world.userIds].sort());
    await inSandbox(async (sandbox) => {
      for (const user of [world.a.userId, world.b.userId]) {
        const uid = expectRows(await sandbox.as('authenticated', user, 'SELECT auth.uid() AS uid'));
        expect(uid[0]?.['uid']).toBe(user);
      }
    });
  });

  it('R16.4 deletes every row it created and leaves the sample rows unchanged', async () => {
    const sampleDigest = async (): Promise<string> =>
      String(
        (
          await getPool().query(
            `SELECT md5(coalesce(string_agg(c::text, '|' ORDER BY c::text), '')) AS d FROM public.corpses c WHERE c.is_sample`,
          )
        ).rows[0]?.d,
      );
    const before = await sampleDigest();
    const temporary = await createWorld();
    await destroyWorld(temporary);
    const leftovers = await getPool().query(
      `SELECT (SELECT count(*) FROM auth.users WHERE id = ANY($1::uuid[])) +
              (SELECT count(*) FROM public.profiles WHERE id = ANY($1::uuid[])) +
              (SELECT count(*) FROM public.corpses WHERE id = ANY($2::uuid[])) AS n`,
      [temporary.userIds, temporary.corpseIds],
    );
    expect(Number(leftovers.rows[0]?.n)).toBe(0);
    expect(await sampleDigest()).toBe(before);
  });

  it('R16.5 rejects INSERT, UPDATE, and DELETE under anon on every table and leaves all rows identical', async () => {
    await inSandbox(async (sandbox) => {
      const corpse = world.a.corpseId;
      const attempts: string[] = [
        `INSERT INTO public.profiles (id) VALUES ('${randomUUID()}')`,
        "UPDATE public.profiles SET email = 'x'",
        'DELETE FROM public.profiles',
        "INSERT INTO public.corpses (is_sample, title, source_language, original_code, code_hash) VALUES (true, 't', 'es3', 'c', 'h')",
        "UPDATE public.corpses SET title = 'x'",
        'DELETE FROM public.corpses',
        ...CHILD_KEYS.flatMap((table) => [
          CHILD[table].insert.replace('$1', `'${corpse}'`),
          `UPDATE public.${table} SET ${CHILD[table].set}`,
          `DELETE FROM public.${table}`,
        ]),
      ];
      for (const sql of attempts) {
        const before = await digest(sandbox);
        expectDenied(await sandbox.as('anon', null, sql));
        expect(await digest(sandbox), sql).toBe(before);
      }
    });
  });

  it('R16.6 keeps the rows of each simulated user invisible and untouchable to the other', async () => {
    const pairs: Array<[UserWorld, UserWorld]> = [
      [world.a, world.b],
      [world.b, world.a],
    ];
    await inSandbox(async (sandbox) => {
      for (const [actor, victim] of pairs) {
        const before = await digest(sandbox);
        expect(expectRows(await sandbox.as('authenticated', actor.userId, 'SELECT id FROM public.corpses WHERE id = $1', [victim.corpseId]))).toHaveLength(0);
        expectAffected(await sandbox.as('authenticated', actor.userId, "UPDATE public.corpses SET title = 'x' WHERE id = $1", [victim.corpseId]), 0);
        expectAffected(await sandbox.as('authenticated', actor.userId, 'DELETE FROM public.corpses WHERE id = $1', [victim.corpseId]), 0);
        for (const table of CHILD_KEYS) {
          expect(expectRows(await sandbox.as('authenticated', actor.userId, `SELECT id FROM public.${table} WHERE corpse_id = $1`, [victim.corpseId]))).toHaveLength(0);
          expectAffected(await sandbox.as('authenticated', actor.userId, `UPDATE public.${table} SET ${CHILD[table].set} WHERE corpse_id = $1`, [victim.corpseId]), 0);
          expectAffected(await sandbox.as('authenticated', actor.userId, `DELETE FROM public.${table} WHERE corpse_id = $1`, [victim.corpseId]), 0);
          expect((await sandbox.as('authenticated', actor.userId, CHILD[table].insert, [victim.corpseId])).ok).toBe(false);
        }
        expect(await digest(sandbox)).toBe(before);
      }
    });
  });
});
