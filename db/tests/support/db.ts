// Database helpers for the Verification_Suite: pool, skip handling, role sessions, and fixtures.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, inject } from 'vitest';
import { missingDbVariables, testDatabaseUrl } from './env.ts';

let pool: pg.Pool | undefined;

/** Pool connected as the migration owner (superuser in the disposable database). */
export function getPool(): pg.Pool {
  const status = inject('dbStatus');
  if (status.kind === 'unreachable') throw new Error(status.message);
  if (status.kind === 'skipped') throw new Error(status.message);
  pool ??= new pg.Pool({ connectionString: testDatabaseUrl(), max: 4, connectionTimeoutMillis: 10_000 });
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/** Declares a suite that needs the database. It is reported as skipped when the variables are unset. */
export function dbDescribe(name: string, body: () => void): void {
  const missing = missingDbVariables();
  if (missing.length > 0) {
    describe.skip(`${name} [skipped: ${missing.join(', ')} is not set]`, body);
  } else {
    describe(name, body);
  }
}

export type Role = 'anon' | 'authenticated';

export type Attempt =
  | { ok: true; rows: Record<string, unknown>[]; rowCount: number }
  | { ok: false; code: string; message: string };

/**
 * A transaction that is always rolled back. Statements can run as the migration owner (`admin`)
 * or as an API role (`as`). Each attempt sits in a savepoint so a failing statement does not abort the transaction.
 */
export class Sandbox {
  readonly client: pg.PoolClient;

  constructor(client: pg.PoolClient) {
    this.client = client;
  }

  async admin(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    const result = await this.client.query(sql, params);
    return result.rows as Record<string, unknown>[];
  }

  async as(role: Role, userId: string | null, sql: string, params: unknown[] = []): Promise<Attempt> {
    await this.client.query('SAVEPOINT attempt');
    try {
      await this.client.query(`SET LOCAL ROLE ${role}`);
      await this.client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId ?? '']);
      const result = await this.client.query(sql, params);
      await this.client.query('RESET ROLE');
      await this.client.query('RELEASE SAVEPOINT attempt');
      return { ok: true, rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount ?? 0 };
    } catch (error) {
      await this.client.query('ROLLBACK TO SAVEPOINT attempt');
      const code = (error as { code?: string }).code ?? 'UNKNOWN';
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, code, message };
    }
  }
}

export async function inSandbox<T>(body: (sandbox: Sandbox) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    return await body(new Sandbox(client));
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Committed fixtures, deleted in afterAll (Requirement 16.4)
// ---------------------------------------------------------------------------

export interface UserWorld {
  userId: string;
  email: string;
  corpseId: string;
  curseId: string;
  seanceId: string;
  reincarnationId: string;
}

export interface World {
  a: UserWorld;
  b: UserWorld;
  sampleId: string;
  userIds: string[];
  corpseIds: string[];
}

async function createUserWorld(client: pg.PoolClient, label: string): Promise<UserWorld> {
  const world: UserWorld = {
    userId: randomUUID(),
    email: `suite-${label}-${randomUUID()}@example.test`,
    corpseId: randomUUID(),
    curseId: randomUUID(),
    seanceId: randomUUID(),
    reincarnationId: randomUUID(),
  };
  await client.query('INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)', [
    world.userId,
    world.email,
    JSON.stringify({ user_name: `suite-${label}`, avatar_url: `https://example.test/${label}.png` }),
  ]);
  await client.query(
    `INSERT INTO public.corpses (id, user_id, is_sample, title, source_language, original_code, code_hash, status)
     VALUES ($1, $2, false, $3, 'es5-jquery', 'function f(){return 1;}', 'hash', 'INFECTED')`,
    [world.corpseId, world.userId, `Suite corpse ${label}`],
  );
  await client.query(
    `INSERT INTO public.curses (id, corpse_id, curse_type, severity, line_number, description, exorcism_strategy)
     VALUES ($1, $2, 'VAR_HOISTING', 'HEX', 1, 'Suite curse description', 'Suite exorcism strategy')`,
    [world.curseId, world.corpseId],
  );
  await client.query(
    `INSERT INTO public.seance_specs (id, corpse_id, requirements_md, design_md, invariants_json)
     VALUES ($1, $2, 'requirements', 'design', '{}'::jsonb)`,
    [world.seanceId, world.corpseId],
  );
  await client.query(
    `INSERT INTO public.reincarnations (id, corpse_id, target_stack, modern_code, pbt_test_code)
     VALUES ($1, $2, 'TypeScript', 'export const x = 1;', 'return null;')`,
    [world.reincarnationId, world.corpseId],
  );
  return world;
}

/** Creates two users A and B, each owning a corpse with one row in every child table. */
export async function createWorld(): Promise<World> {
  const client = await getPool().connect();
  try {
    const a = await createUserWorld(client, 'a');
    const b = await createUserWorld(client, 'b');
    const sample = await client.query<{ id: string }>('SELECT id FROM public.corpses WHERE is_sample ORDER BY title LIMIT 1');
    const sampleId = sample.rows[0]?.id;
    if (sampleId === undefined) throw new Error('No Sample_Corpse row found. Was V2 applied?');
    return { a, b, sampleId, userIds: [a.userId, b.userId], corpseIds: [a.corpseId, b.corpseId] };
  } finally {
    client.release();
  }
}

/** Deletes every row the world created and verifies that none is left. */
export async function destroyWorld(world: World): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('DELETE FROM public.curses WHERE corpse_id = ANY($1::uuid[])', [world.corpseIds]);
    await client.query('DELETE FROM public.seance_specs WHERE corpse_id = ANY($1::uuid[])', [world.corpseIds]);
    await client.query('DELETE FROM public.reincarnations WHERE corpse_id = ANY($1::uuid[])', [world.corpseIds]);
    await client.query('DELETE FROM public.corpses WHERE id = ANY($1::uuid[])', [world.corpseIds]);
    await client.query('DELETE FROM public.profiles WHERE id = ANY($1::uuid[])', [world.userIds]);
    await client.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [world.userIds]);
    const leftover = await client.query<{ n: number }>(
      `SELECT (
         (SELECT count(*) FROM public.corpses WHERE id = ANY($1::uuid[])) +
         (SELECT count(*) FROM public.profiles WHERE id = ANY($2::uuid[])) +
         (SELECT count(*) FROM auth.users WHERE id = ANY($2::uuid[]))
       )::int AS n`,
      [world.corpseIds, world.userIds],
    );
    if ((leftover.rows[0]?.n ?? 0) !== 0) throw new Error('Fixture cleanup left rows behind.');
  } finally {
    client.release();
  }
}

/** Snapshot of the rows owned by the world, used to prove rows are identical before and after statements. */
export async function snapshotWorld(sandbox: Sandbox, world: World): Promise<string> {
  const rows = await sandbox.admin(
    `SELECT md5(coalesce(string_agg(t, '|' ORDER BY t), '')) AS digest FROM (
       SELECT c::text AS t FROM public.corpses c WHERE c.id = ANY($1::uuid[])
       UNION ALL SELECT p::text FROM public.profiles p WHERE p.id = ANY($2::uuid[])
       UNION ALL SELECT x::text FROM public.curses x WHERE x.corpse_id = ANY($1::uuid[])
       UNION ALL SELECT x::text FROM public.seance_specs x WHERE x.corpse_id = ANY($1::uuid[])
       UNION ALL SELECT x::text FROM public.reincarnations x WHERE x.corpse_id = ANY($1::uuid[])
     ) s`,
    [world.corpseIds, world.userIds],
  );
  return String(rows[0]?.['digest']);
}

export const LAZARUS_TABLES = ['profiles', 'corpses', 'curses', 'seance_specs', 'reincarnations'] as const;
export const CHILD_TABLES = ['curses', 'seance_specs', 'reincarnations'] as const;
