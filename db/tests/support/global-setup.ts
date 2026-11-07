// Vitest global setup. Runs once before the Verification_Suite.
//  - TEST_DATABASE_URL unset: database tests are skipped (Requirement 16.7).
//  - Database unreachable within 10 seconds: database tests fail with a connection message (Requirement 16.9).
//  - Otherwise: applies the Supabase stub, migrates with Flyway, and snapshots the sample rows
//    so that teardown can prove the suite left them unchanged (Requirement 16.4).
import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { missingDbVariables, testDatabaseUrl, parseDbUrl } from './env.ts';
import { flywayAvailable, runFlyway } from './flyway.ts';

export type DbStatus =
  | { kind: 'ready' }
  | { kind: 'skipped'; message: string }
  | { kind: 'unreachable'; message: string };

declare module 'vitest' {
  export interface ProvidedContext {
    dbStatus: DbStatus;
  }
}

const STUB_SQL_URL = new URL('../../harness/supabase-stub.sql', import.meta.url);

const SAMPLE_SNAPSHOT_SQL = `
  select md5(coalesce(string_agg(row_text, '|' order by row_text), '')) as digest, count(*)::int as rows from (
    select c::text as row_text from public.corpses c where c.is_sample
    union all select cu::text from public.curses cu join public.corpses c on c.id = cu.corpse_id where c.is_sample
    union all select s::text from public.seance_specs s join public.corpses c on c.id = s.corpse_id where c.is_sample
    union all select r::text from public.reincarnations r join public.corpses c on c.id = r.corpse_id where c.is_sample
  ) t`;

async function sampleSnapshot(client: pg.Client): Promise<string> {
  const result = await client.query<{ digest: string; rows: number }>(SAMPLE_SNAPSHOT_SQL);
  const row = result.rows[0];
  return `${row?.digest}:${row?.rows}`;
}

export default async function setup(project: TestProject): Promise<(() => Promise<void>) | undefined> {
  const missing = missingDbVariables();
  if (missing.length > 0) {
    project.provide('dbStatus', {
      kind: 'skipped',
      message: `skipped: ${missing.join(', ')} is not set`,
    });
    return undefined;
  }

  const url = testDatabaseUrl();
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    project.provide('dbStatus', {
      kind: 'unreachable',
      message: `Database connection failed within 10 seconds: ${reason}`,
    });
    return undefined;
  }

  try {
    await client.query(readFileSync(STUB_SQL_URL, 'utf8'));
    if (!flywayAvailable()) {
      throw new Error('The Flyway CLI is not on PATH. Install Flyway to run the database tests.');
    }
    const connection = parseDbUrl(url);
    const migrated = runFlyway(connection, connection.database);
    if (migrated.code !== 0) {
      throw new Error(`Flyway migrate failed for the test database:\n${migrated.output}`);
    }
    const before = await sampleSnapshot(client);
    project.provide('dbStatus', { kind: 'ready' });

    return async () => {
      const verifier = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
      await verifier.connect();
      try {
        const after = await sampleSnapshot(verifier);
        if (after !== before) {
          throw new Error(`Sample rows changed during the run (before ${before}, after ${after}).`);
        }
      } finally {
        await verifier.end();
      }
    };
  } finally {
    await client.end();
  }
}
