// Creates a throwaway database next to the test database for migration tests (Requirements 7 and 8).
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { connectionStringFor, parseDbUrl, testDatabaseUrl, type DbConnection } from './env.ts';
import { runFlyway, type FlywayOptions, type FlywayResult } from './flyway.ts';

const STUB_SQL = readFileSync(new URL('../../harness/supabase-stub.sql', import.meta.url), 'utf8');

export interface ScratchDb {
  name: string;
  connection: DbConnection;
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  flyway(options?: FlywayOptions): FlywayResult;
}

export async function withScratchDatabase<T>(body: (db: ScratchDb) => Promise<T>, applyStub = true): Promise<T> {
  const connection = parseDbUrl(testDatabaseUrl());
  const admin = new pg.Client({ connectionString: connectionStringFor(connection, connection.database) });
  await admin.connect();
  const name = `lazarus_scratch_${randomBytes(6).toString('hex')}`;
  await admin.query(`CREATE DATABASE ${name}`);

  const client = new pg.Client({ connectionString: connectionStringFor(connection, name) });
  await client.connect();
  try {
    if (applyStub) await client.query(STUB_SQL);
    const db: ScratchDb = {
      name,
      connection,
      async query(sql, params = []) {
        const result = await client.query(sql, params);
        return result.rows as never;
      },
      flyway: (options) => runFlyway(connection, name, options),
    };
    return await body(db);
  } finally {
    await client.end().catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }
}
