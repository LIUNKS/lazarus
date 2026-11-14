// Verification_Suite: Flyway connection, ordering, idempotence, and failure behavior (Requirements 7.7 to 7.9 and 8).
// Every test runs against its own scratch database next to the test database.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { dbDescribe } from './support/db.ts';
import { WORKSPACE_ROOT, jdbcUrlFor } from './support/env.ts';
import { run } from './support/process.ts';
import { withScratchDatabase, type ScratchDb } from './support/scratch-db.ts';

const MIGRATIONS_DIR = join(WORKSPACE_ROOT, 'db', 'migrations');

function runner(db: ScratchDb): { code: number; output: string } {
  const result = run('node', ['scripts/db-migrate.ts'], {
    env: {
      ...process.env,
      FLYWAY_URL: jdbcUrlFor(db.connection, db.name),
      FLYWAY_USER: db.connection.user,
      FLYWAY_PASSWORD: db.connection.password,
    },
  });
  return { code: result.code, output: result.output };
}

async function history(db: ScratchDb): Promise<Array<{ version: string; success: boolean }>> {
  return db.query<{ version: string; success: boolean }>(
    'SELECT version, success FROM public.flyway_schema_history WHERE version IS NOT NULL ORDER BY installed_rank',
  );
}

const SNAPSHOT_SQL = `
  SELECT md5(coalesce(string_agg(t, '|' ORDER BY t), '')) AS digest FROM (
    SELECT p::text AS t FROM public.profiles p
    UNION ALL SELECT c::text FROM public.corpses c
    UNION ALL SELECT x::text FROM public.curses x
    UNION ALL SELECT x::text FROM public.seance_specs x
    UNION ALL SELECT x::text FROM public.reincarnations x
  ) s`;

async function snapshot(db: ScratchDb): Promise<string> {
  return String((await db.query(SNAPSHOT_SQL))[0]?.['digest']);
}

async function sampleCount(db: ScratchDb): Promise<number> {
  return Number((await db.query('SELECT count(*)::int AS n FROM public.corpses WHERE is_sample'))[0]?.['n']);
}

function copyMigrations(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lazarus-migrations-'));
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  return dir;
}

dbDescribe('R7 and R8 Flyway migrations', () => {
  it('R7.7 connects with FLYWAY_URL, FLYWAY_USER, and FLYWAY_PASSWORD from the environment', async () => {
    await withScratchDatabase(async (db) => {
      const result = db.flyway();
      expect(result.code, result.output).toBe(0);
      expect(await history(db)).toHaveLength(3);
    });
  });

  it('R7.8 fails with an error and applies nothing when the connection settings are missing', async () => {
    await withScratchDatabase(async (db) => {
      const result = db.flyway({ env: { FLYWAY_URL: null, FLYWAY_USER: null, FLYWAY_PASSWORD: null } });
      expect(result.code).not.toBe(0);
      expect(result.output).toMatch(/url|connect|database/i);
      const tables = await db.query("SELECT to_regclass('public.flyway_schema_history') AS t");
      expect(tables[0]?.['t']).toBeNull();
    });
  });

  it('R7.9 and R8.8 a changed applied migration fails validation, applies nothing, and names the file', async () => {
    const dir = copyMigrations();
    try {
      await withScratchDatabase(async (db) => {
        const location = `-locations=filesystem:${dir}`;
        expect(db.flyway({ args: [location] }).code).toBe(0);
        const before = await history(db);
        const snapshotBefore = await snapshot(db);

        const changed = join(dir, 'V1__create_lazarus_schema.sql');
        writeFileSync(changed, `${readFileSync(changed, 'utf8')}\n-- tampered after being applied\n`);
        writeFileSync(join(dir, 'V4__pending_probe.sql'), 'CREATE TABLE public.suite_pending_probe (id int);\n');

        const result = db.flyway({ args: [location] });
        expect(result.code).not.toBe(0);
        expect(result.output).toMatch(/checksum/i);
        expect(result.output).toMatch(/checksum mismatch for migration version 1/i);
        expect(await history(db)).toEqual(before);
        expect(await snapshot(db)).toBe(snapshotBefore);
        const probe = await db.query("SELECT to_regclass('public.suite_pending_probe') AS t");
        expect(probe[0]?.['t']).toBeNull();
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('R8.3 applies V1, V2, and V3 in order on an empty database, records all three, and exits with code 0', async () => {
    await withScratchDatabase(async (db) => {
      const result = runner(db);
      expect(result.code, result.output).toBe(0);
      const rows = await history(db);
      expect(rows.map((r) => r.version)).toEqual(['1', '2', '3']);
      expect(rows.every((r) => r.success)).toBe(true);
    });
  });

  it('R8.4 applies only V2 and V3 when V1 is applied and leaves existing rows unchanged', async () => {
    await withScratchDatabase(async (db) => {
      expect(db.flyway({ args: ['-target=1'] }).code).toBe(0);
      expect((await history(db)).map((r) => r.version)).toEqual(['1']);

      const userId = '7d1d3c0a-0000-4000-8000-00000000a001';
      await db.query("INSERT INTO auth.users (id, email) VALUES ($1, 'before@example.test')", [userId]);
      await db.query(
        `INSERT INTO public.corpses (user_id, title, source_language, original_code, code_hash)
         VALUES ($1, 'Existing corpse', 'es3', 'function x(){}', 'h')`,
        [userId],
      );
      const before = await snapshot(db);

      const result = runner(db);
      expect(result.code, result.output).toBe(0);
      expect((await history(db)).map((r) => r.version)).toEqual(['1', '2', '3']);
      const owned = await db.query('SELECT count(*)::int AS n FROM public.corpses WHERE user_id = $1', [userId]);
      expect(owned[0]?.['n']).toBe(1);
      // Only the seeded rows were added: removing them must reproduce the earlier snapshot.
      await db.query("DELETE FROM public.corpses WHERE is_sample");
      expect(await snapshot(db)).toBe(before);
    });
  });

  it('R8.5 applies zero migrations and changes no row when all migrations are already applied', async () => {
    await withScratchDatabase(async (db) => {
      expect(runner(db).code).toBe(0);
      const before = await snapshot(db);
      const rowsBefore = await history(db);
      const result = runner(db);
      expect(result.code, result.output).toBe(0);
      expect(result.output).toMatch(/up to date|no migration necessary/i);
      expect(await snapshot(db)).toBe(before);
      expect(await history(db)).toEqual(rowsBefore);
    });
  });

  it('R8.6 leaves exactly 3 Sample_Corpse rows after two runs on an empty database', async () => {
    await withScratchDatabase(async (db) => {
      expect(runner(db).code).toBe(0);
      expect(runner(db).code).toBe(0);
      expect(await sampleCount(db)).toBe(3);
    });
  });

  it('R8.7 rolls back a failing migration, keeps earlier ones, and names the failing file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lazarus-failing-'));
    try {
      cpSync(join(MIGRATIONS_DIR, 'V1__create_lazarus_schema.sql'), join(dir, 'V1__create_lazarus_schema.sql'));
      writeFileSync(
        join(dir, 'V2__failing_probe.sql'),
        'CREATE TABLE public.suite_failing_probe (id int);\nINSERT INTO public.table_that_does_not_exist VALUES (1);\n',
      );
      await withScratchDatabase(async (db) => {
        const result = db.flyway({ args: [`-locations=filesystem:${dir}`] });
        expect(result.code).not.toBe(0);
        expect(result.output).toContain('V2__failing_probe.sql');
        const probe = await db.query("SELECT to_regclass('public.suite_failing_probe') AS t");
        expect(probe[0]?.['t']).toBeNull();
        const applied = (await history(db)).filter((r) => r.success);
        expect(applied.map((r) => r.version)).toEqual(['1']);
        const corpses = await db.query("SELECT to_regclass('public.corpses') AS t");
        expect(corpses[0]?.['t']).not.toBeNull();
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
