// Runs the Flyway CLI against a database for the Verification_Suite.
import { spawnSync } from 'node:child_process';
import { WORKSPACE_ROOT, jdbcUrlFor, type DbConnection } from './env.ts';
import { quoteArg } from './process.ts';

export interface FlywayResult {
  code: number;
  output: string;
}

export interface FlywayOptions {
  /** Extra Flyway arguments such as -locations=filesystem:<dir> or -target=1. */
  args?: string[];
  /** Overrides the FLYWAY_* variables; `null` removes a variable. */
  env?: Partial<Record<'FLYWAY_URL' | 'FLYWAY_USER' | 'FLYWAY_PASSWORD', string | null>>;
  command?: string;
}

export function flywayAvailable(): boolean {
  const lookup = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['flyway'], { stdio: 'ignore' });
  return lookup.status === 0;
}

export function runFlyway(
  connection: DbConnection,
  database: string,
  options: FlywayOptions = {},
): FlywayResult {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FLYWAY_URL: jdbcUrlFor(connection, database),
    FLYWAY_USER: connection.user,
    FLYWAY_PASSWORD: connection.password,
  };
  for (const [name, value] of Object.entries(options.env ?? {})) {
    if (value === null) delete env[name];
    else if (value !== undefined) env[name] = value;
  }
  const args = ['-configFiles=db/flyway.conf', ...(options.args ?? []), options.command ?? 'migrate'];
  const settings = { cwd: WORKSPACE_ROOT, env, encoding: 'utf8' } as const;
  const result =
    process.platform === 'win32'
      ? spawnSync(['flyway', ...args.map(quoteArg)].join(' '), { ...settings, shell: true })
      : spawnSync('flyway', args, settings);
  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}`,
  };
}
