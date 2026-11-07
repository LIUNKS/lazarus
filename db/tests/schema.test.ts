// Verification_Suite: tables, constraints, indexes, and the profile trigger (Requirements 9 to 11).
import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { LAZARUS_TABLES, closePool, dbDescribe, getPool, inSandbox, type Sandbox } from './support/db.ts';

interface Column {
  name: string;
  type: string;
  nullable: boolean;
  hasDefault: boolean;
  defaultText: string | null;
}

async function columns(table: string): Promise<Map<string, Column>> {
  const result = await getPool().query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return new Map(
    result.rows.map((row) => [
      row.column_name as string,
      {
        name: row.column_name as string,
        type: row.data_type as string,
        nullable: row.is_nullable === 'YES',
        hasDefault: row.column_default !== null,
        defaultText: row.column_default as string | null,
      },
    ]),
  );
}

interface ForeignKey {
  column: string;
  references: string;
  onDelete: string;
}

async function foreignKeys(table: string): Promise<ForeignKey[]> {
  const result = await getPool().query(
    `SELECT a.attname AS column, c.confrelid::regclass::text AS refs, c.confdeltype AS on_delete
     FROM pg_constraint c
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.contype = 'f' AND c.conrelid = ('public.' || $1)::regclass`,
    [table],
  );
  return result.rows.map((row) => ({
    column: row.column as string,
    references: row.refs as string,
    onDelete: row.on_delete as string,
  }));
}

async function primaryKey(table: string): Promise<string[]> {
  const result = await getPool().query(
    `SELECT a.attname FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
     WHERE i.indisprimary AND i.indrelid = ('public.' || $1)::regclass`,
    [table],
  );
  return result.rows.map((row) => row.attname as string);
}

function expectColumns(actual: Map<string, Column>, expected: Record<string, string>): void {
  expect([...actual.keys()].sort()).toEqual(Object.keys(expected).sort());
  for (const [name, type] of Object.entries(expected)) expect(actual.get(name)?.type, name).toBe(type);
}

const SAMPLE_CORPSE = `INSERT INTO public.corpses (is_sample, title, source_language, original_code, code_hash)
  VALUES (true, 'probe', 'es3', 'function f(){}', 'hash')`;

async function corpseCount(sandbox: Sandbox): Promise<number> {
  return Number((await sandbox.admin('SELECT count(*)::int AS n FROM public.corpses'))[0]?.['n']);
}

afterAll(async () => {
  await closePool();
});

dbDescribe('R9 table definitions', () => {
  it('R9.1 creates profiles with the specified columns and a cascading key to auth.users', async () => {
    const cols = await columns('profiles');
    expectColumns(cols, {
      id: 'uuid',
      email: 'text',
      github_username: 'text',
      avatar_url: 'text',
      created_at: 'timestamp with time zone',
    });
    for (const name of ['email', 'github_username', 'avatar_url']) expect(cols.get(name)?.nullable).toBe(true);
    expect(await primaryKey('profiles')).toEqual(['id']);
    expect(await foreignKeys('profiles')).toEqual([{ column: 'id', references: 'auth.users', onDelete: 'c' }]);
  });

  it('R9.2 creates corpses with the specified columns, a nullable cascading owner, and is_sample NOT NULL DEFAULT false', async () => {
    const cols = await columns('corpses');
    expectColumns(cols, {
      id: 'uuid',
      user_id: 'uuid',
      is_sample: 'boolean',
      title: 'text',
      source_language: 'text',
      original_code: 'text',
      code_hash: 'text',
      repo_url: 'text',
      status: 'text',
      created_at: 'timestamp with time zone',
    });
    expect(cols.get('user_id')?.nullable).toBe(true);
    expect(cols.get('is_sample')?.nullable).toBe(false);
    expect(cols.get('is_sample')?.defaultText).toBe('false');
    expect(await foreignKeys('corpses')).toEqual([{ column: 'user_id', references: 'profiles', onDelete: 'c' }]);
  });

  it('R9.3 creates curses with the specified columns and a NOT NULL cascading corpse_id', async () => {
    const cols = await columns('curses');
    expectColumns(cols, {
      id: 'uuid',
      corpse_id: 'uuid',
      curse_type: 'text',
      severity: 'text',
      line_number: 'integer',
      description: 'text',
      exorcism_strategy: 'text',
    });
    expect(cols.get('corpse_id')?.nullable).toBe(false);
    expect(await foreignKeys('curses')).toEqual([{ column: 'corpse_id', references: 'corpses', onDelete: 'c' }]);
  });

  it('R9.4 creates seance_specs with the specified columns and a NOT NULL cascading corpse_id', async () => {
    const cols = await columns('seance_specs');
    expectColumns(cols, {
      id: 'uuid',
      corpse_id: 'uuid',
      requirements_md: 'text',
      design_md: 'text',
      invariants_json: 'jsonb',
      approved_at: 'timestamp with time zone',
    });
    expect(cols.get('corpse_id')?.nullable).toBe(false);
    expect(await foreignKeys('seance_specs')).toEqual([{ column: 'corpse_id', references: 'corpses', onDelete: 'c' }]);
  });

  it('R9.5 creates reincarnations with the specified columns and a NOT NULL cascading corpse_id', async () => {
    const cols = await columns('reincarnations');
    expectColumns(cols, {
      id: 'uuid',
      corpse_id: 'uuid',
      target_stack: 'text',
      modern_code: 'text',
      pbt_test_code: 'text',
      pbt_passed: 'boolean',
      total_runs: 'integer',
      execution_time_ms: 'integer',
      created_at: 'timestamp with time zone',
    });
    expect(cols.get('corpse_id')?.nullable).toBe(false);
    expect(await foreignKeys('reincarnations')).toEqual([{ column: 'corpse_id', references: 'corpses', onDelete: 'c' }]);
  });

  it('R9.6 uses uuid primary keys with gen_random_uuid() except profiles, which has no default', async () => {
    for (const table of ['corpses', 'curses', 'seance_specs', 'reincarnations']) {
      const id = (await columns(table)).get('id');
      expect(id?.type, table).toBe('uuid');
      expect(id?.defaultText, table).toContain('gen_random_uuid()');
      expect(await primaryKey(table)).toEqual(['id']);
    }
    const profileId = (await columns('profiles')).get('id');
    expect(profileId?.type).toBe('uuid');
    expect(profileId?.hasDefault).toBe(false);
  });

  it('R9.7 uses timestamptz for timestamps and no timestamp without time zone', async () => {
    const expected: Record<string, string> = {
      profiles: 'created_at',
      corpses: 'created_at',
      seance_specs: 'approved_at',
      reincarnations: 'created_at',
    };
    for (const [table, column] of Object.entries(expected)) {
      expect((await columns(table)).get(column)?.type, `${table}.${column}`).toBe('timestamp with time zone');
    }
    for (const table of LAZARUS_TABLES) {
      for (const column of (await columns(table)).values()) {
        expect(column.type, `${table}.${column.name}`).not.toBe('timestamp without time zone');
      }
    }
  });

  it('R9.8 creates no users table in the public schema', async () => {
    const result = await getPool().query("SELECT to_regclass('public.users') AS t");
    expect(result.rows[0]?.t).toBeNull();
  });

  it('R9.9 creates all five tables in the public schema', async () => {
    for (const table of LAZARUS_TABLES) {
      const result = await getPool().query('SELECT to_regclass($1) AS t', [`public.${table}`]);
      expect(result.rows[0]?.t, table).not.toBeNull();
    }
  });

  it('R9.10 uses the specified column types', async () => {
    const corpses = await columns('corpses');
    expect(corpses.get('code_hash')?.type).toBe('text');
    expect((await columns('reincarnations')).get('pbt_passed')?.type).toBe('boolean');
    for (const column of ['total_runs', 'execution_time_ms']) {
      expect((await columns('reincarnations')).get(column)?.type).toBe('integer');
    }
    expect((await columns('curses')).get('line_number')?.type).toBe('integer');
    expect((await columns('seance_specs')).get('invariants_json')?.type).toBe('jsonb');
  });

  it('R9.11 deleting an auth user cascades to their data and spares samples and other users', async () => {
    await inSandbox(async (sandbox) => {
      const owner = randomUUID();
      const other = randomUUID();
      await sandbox.admin('INSERT INTO auth.users (id, email) VALUES ($1, $3), ($2, $4)', [
        owner,
        other,
        'owner@example.test',
        'other@example.test',
      ]);
      const ownerCorpse = randomUUID();
      const otherCorpse = randomUUID();
      for (const [corpse, user] of [
        [ownerCorpse, owner],
        [otherCorpse, other],
      ] as const) {
        await sandbox.admin(
          `INSERT INTO public.corpses (id, user_id, title, source_language, original_code, code_hash)
           VALUES ($1, $2, 't', 'es3', 'c', 'h')`,
          [corpse, user],
        );
        await sandbox.admin(
          `INSERT INTO public.curses (corpse_id, curse_type, severity, line_number, description, exorcism_strategy)
           VALUES ($1, 'VAR_HOISTING', 'HEX', 1, 'd', 's')`,
          [corpse],
        );
      }
      const samplesBefore = Number(
        (await sandbox.admin('SELECT count(*)::int AS n FROM public.corpses WHERE is_sample'))[0]?.['n'],
      );

      await sandbox.admin('DELETE FROM auth.users WHERE id = $1', [owner]);

      const count = async (sql: string, id: string): Promise<number> =>
        Number((await sandbox.admin(sql, [id]))[0]?.['n']);
      expect(await count('SELECT count(*)::int AS n FROM public.profiles WHERE id = $1', owner)).toBe(0);
      expect(await count('SELECT count(*)::int AS n FROM public.corpses WHERE user_id = $1', owner)).toBe(0);
      expect(await count('SELECT count(*)::int AS n FROM public.curses WHERE corpse_id = $1', ownerCorpse)).toBe(0);
      expect(await count('SELECT count(*)::int AS n FROM public.corpses WHERE user_id = $1', other)).toBe(1);
      expect(await count('SELECT count(*)::int AS n FROM public.curses WHERE corpse_id = $1', otherCorpse)).toBe(1);
      const samplesAfter = Number(
        (await sandbox.admin('SELECT count(*)::int AS n FROM public.corpses WHERE is_sample'))[0]?.['n'],
      );
      expect(samplesAfter).toBe(samplesBefore);
    });
  });
});

dbDescribe('R10 check constraints and indexes', () => {
  async function rejects(sql: string, params: unknown[], expectedCodes: string[]): Promise<void> {
    await inSandbox(async (sandbox) => {
      const before = await corpseCount(sandbox);
      await sandbox.client.query('SAVEPOINT probe');
      let code = 'OK';
      try {
        await sandbox.client.query(sql, params);
      } catch (error) {
        code = (error as { code?: string }).code ?? 'UNKNOWN';
        await sandbox.client.query('ROLLBACK TO SAVEPOINT probe');
      }
      expect(expectedCodes, `statement was accepted: ${sql}`).toContain(code);
      expect(await corpseCount(sandbox)).toBe(before);
    });
  }

  it('R10.1 requires an owner unless the corpse is a sample', async () => {
    await rejects(
      `INSERT INTO public.corpses (is_sample, title, source_language, original_code, code_hash)
       VALUES (false, 't', 'es3', 'c', 'h')`,
      [],
      ['23514'],
    );
    await inSandbox(async (sandbox) => {
      await sandbox.admin(SAMPLE_CORPSE);
    });
  });

  it('R10.2 limits source_language to es3, es5-jquery, and legacy-node', async () => {
    await inSandbox(async (sandbox) => {
      for (const language of ['es3', 'es5-jquery', 'legacy-node']) {
        await sandbox.admin(
          "INSERT INTO public.corpses (is_sample, title, source_language, original_code, code_hash) VALUES (true, 't', $1, 'c', 'h')",
          [language],
        );
      }
    });
    await rejects(
      "INSERT INTO public.corpses (is_sample, title, source_language, original_code, code_hash) VALUES (true, 't', 'python2', 'c', 'h')",
      [],
      ['23514'],
    );
  });

  it('R10.3 limits status to INFECTED, IN_SEANCE, RESURRECTED, and FAILED', async () => {
    await inSandbox(async (sandbox) => {
      for (const status of ['INFECTED', 'IN_SEANCE', 'RESURRECTED', 'FAILED']) {
        await sandbox.admin(
          "INSERT INTO public.corpses (is_sample, title, source_language, original_code, code_hash, status) VALUES (true, 't', 'es3', 'c', 'h', $1)",
          [status],
        );
      }
    });
    await rejects(
      "INSERT INTO public.corpses (is_sample, title, source_language, original_code, code_hash, status) VALUES (true, 't', 'es3', 'c', 'h', 'DEAD')",
      [],
      ['23514'],
    );
  });

  const CURSE_PARENT = `WITH parent AS (${SAMPLE_CORPSE} RETURNING id)`;

  it('R10.4 limits severity to HEX, BLOOD_CURSE, and FATAL', async () => {
    await inSandbox(async (sandbox) => {
      for (const severity of ['HEX', 'BLOOD_CURSE', 'FATAL']) {
        await sandbox.admin(
          `${CURSE_PARENT} INSERT INTO public.curses (corpse_id, curse_type, severity, line_number, description, exorcism_strategy)
           SELECT id, 'VAR_HOISTING', $1, 1, 'd', 's' FROM parent`,
          [severity],
        );
      }
    });
    await rejects(
      `${CURSE_PARENT} INSERT INTO public.curses (corpse_id, curse_type, severity, line_number, description, exorcism_strategy)
       SELECT id, 'VAR_HOISTING', 'MILD', 1, 'd', 's' FROM parent`,
      [],
      ['23514'],
    );
  });

  it('R10.5 limits curse_type to the six curse types', async () => {
    const types = ['GLOBAL_POLLUTION', 'VAR_HOISTING', 'IMPLICIT_COERCION', 'CALLBACK_HELL', 'EVAL_INJECTION', 'PROTOTYPE_POLLUTION'];
    await inSandbox(async (sandbox) => {
      for (const type of types) {
        await sandbox.admin(
          `${CURSE_PARENT} INSERT INTO public.curses (corpse_id, curse_type, severity, line_number, description, exorcism_strategy)
           SELECT id, $1, 'HEX', 1, 'd', 's' FROM parent`,
          [type],
        );
      }
    });
    await rejects(
      `${CURSE_PARENT} INSERT INTO public.curses (corpse_id, curse_type, severity, line_number, description, exorcism_strategy)
       SELECT id, 'UNKNOWN_CURSE', 'HEX', 1, 'd', 's' FROM parent`,
      [],
      ['23514'],
    );
  });

  async function indexDefinitions(table: string): Promise<string[]> {
    const result = await getPool().query("SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1", [table]);
    return result.rows.map((row) => row.indexdef as string);
  }

  it('R10.6 indexes corpses.user_id', async () => {
    expect((await indexDefinitions('corpses')).some((d) => d.includes('(user_id)'))).toBe(true);
  });

  it('R10.7 indexes corpses.code_hash', async () => {
    expect((await indexDefinitions('corpses')).some((d) => d.includes('(code_hash)'))).toBe(true);
  });

  it('R10.8 indexes corpse_id on every child table', async () => {
    for (const table of ['curses', 'seance_specs', 'reincarnations']) {
      expect((await indexDefinitions(table)).some((d) => d.includes('(corpse_id)')), table).toBe(true);
    }
  });

  it('R10.9 rejects a non-sample corpse without an owner and leaves rows unchanged', async () => {
    await rejects(
      `INSERT INTO public.corpses (is_sample, user_id, title, source_language, original_code, code_hash)
       VALUES (false, NULL, 't', 'es3', 'c', 'h')`,
      [],
      ['23514'],
    );
  });

  it('R10.10 rejects values that are not an exact, case-sensitive match', async () => {
    const insertCorpse = `INSERT INTO public.corpses (is_sample, title, source_language, original_code, code_hash, status)
       VALUES (true, 't', $1, 'c', 'h', $2)`;
    await rejects(insertCorpse, ['ES3', 'INFECTED'], ['23514']);
    await rejects(insertCorpse, ['es3', 'resurrected'], ['23514']);
    await rejects(
      `${CURSE_PARENT} INSERT INTO public.curses (corpse_id, curse_type, severity, line_number, description, exorcism_strategy)
       SELECT id, 'var_hoisting', 'hex', 1, 'd', 's' FROM parent`,
      [],
      ['23514'],
    );
  });

  it('R10.11 rejects NULL in is_sample, source_language, status, severity, and curse_type', async () => {
    const nullCodes = ['23502', '23514'];
    await rejects(
      "INSERT INTO public.corpses (is_sample, title, source_language, original_code, code_hash) VALUES (NULL, 't', 'es3', 'c', 'h')",
      [],
      nullCodes,
    );
    await rejects(
      "INSERT INTO public.corpses (is_sample, title, source_language, original_code, code_hash) VALUES (true, 't', NULL, 'c', 'h')",
      [],
      nullCodes,
    );
    await rejects(
      "INSERT INTO public.corpses (is_sample, title, source_language, original_code, code_hash, status) VALUES (true, 't', 'es3', 'c', 'h', NULL)",
      [],
      nullCodes,
    );
    await rejects(
      `${CURSE_PARENT} INSERT INTO public.curses (corpse_id, curse_type, severity, line_number, description, exorcism_strategy)
       SELECT id, 'VAR_HOISTING', NULL, 1, 'd', 's' FROM parent`,
      [],
      nullCodes,
    );
    await rejects(
      `${CURSE_PARENT} INSERT INTO public.curses (corpse_id, curse_type, severity, line_number, description, exorcism_strategy)
       SELECT id, NULL, 'HEX', 1, 'd', 's' FROM parent`,
      [],
      nullCodes,
    );
  });
});

dbDescribe('R11 profile provisioning trigger', () => {
  it('R11.1 inserts exactly one profile for a new auth user in the same transaction', async () => {
    await inSandbox(async (sandbox) => {
      const id = randomUUID();
      await sandbox.admin('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [id, 'one@example.test']);
      const rows = await sandbox.admin('SELECT id FROM public.profiles WHERE id = $1', [id]);
      expect(rows).toHaveLength(1);
    });
  });

  it('R11.2 copies email, user_name, and avatar_url into the profile', async () => {
    await inSandbox(async (sandbox) => {
      const id = randomUUID();
      await sandbox.admin('INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)', [
        id,
        'copy@example.test',
        JSON.stringify({ user_name: 'octo', avatar_url: 'https://example.test/a.png' }),
      ]);
      const [profile] = await sandbox.admin('SELECT email, github_username, avatar_url FROM public.profiles WHERE id = $1', [id]);
      expect(profile).toEqual({ email: 'copy@example.test', github_username: 'octo', avatar_url: 'https://example.test/a.png' });
    });
  });

  it('R11.3 still creates the profile and stores NULL when email or metadata is missing', async () => {
    await inSandbox(async (sandbox) => {
      const bare = randomUUID();
      const partial = randomUUID();
      await sandbox.admin('INSERT INTO auth.users (id) VALUES ($1)', [bare]);
      await sandbox.admin('INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, NULL, $2)', [
        partial,
        JSON.stringify({ user_name: 'only-name' }),
      ]);
      const [first] = await sandbox.admin('SELECT email, github_username, avatar_url FROM public.profiles WHERE id = $1', [bare]);
      const [second] = await sandbox.admin('SELECT email, github_username, avatar_url FROM public.profiles WHERE id = $1', [partial]);
      expect(first).toEqual({ email: null, github_username: null, avatar_url: null });
      expect(second).toEqual({ email: null, github_username: 'only-name', avatar_url: null });
    });
  });

  it('R11.4 declares the trigger function SECURITY DEFINER with a fixed search_path', async () => {
    const result = await getPool().query(
      "SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'handle_new_user' AND pronamespace = 'public'::regnamespace",
    );
    expect(result.rows[0]?.prosecdef).toBe(true);
    expect((result.rows[0]?.proconfig as string[]).some((setting) => setting.startsWith('search_path='))).toBe(true);
  });

  it('R11.5 leaves an existing profile unchanged and does not fail the user insert', async () => {
    await inSandbox(async (sandbox) => {
      // A second trigger runs the same function again for the same user, which hits the existing profile.
      await sandbox.admin(
        'CREATE TRIGGER suite_duplicate AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()',
      );
      const id = randomUUID();
      await sandbox.admin('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [id, 'dup@example.test']);
      const rows = await sandbox.admin('SELECT email FROM public.profiles WHERE id = $1', [id]);
      expect(rows).toEqual([{ email: 'dup@example.test' }]);
    });
  });

  it('R11.6 revokes EXECUTE on the trigger function from PUBLIC, anon, and authenticated', async () => {
    const result = await getPool().query(
      `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
              coalesce(p.proacl::text, '') AS acl
       FROM pg_proc p WHERE p.proname = 'handle_new_user' AND p.pronamespace = 'public'::regnamespace`,
    );
    expect(result.rows[0]?.anon).toBe(false);
    expect(result.rows[0]?.authenticated).toBe(false);
    expect(String(result.rows[0]?.acl)).not.toMatch(/(^\{|,)=X\//);
  });
});
