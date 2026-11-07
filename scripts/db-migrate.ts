// Migration_Runner: validates the Flyway environment, then runs Flyway once.
// `pnpm db:migrate` loads `.env` with dotenv-cli before this script starts.
// This script never prints the value of any environment variable.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REQUIRED_VARIABLES = ['FLYWAY_URL', 'FLYWAY_USER', 'FLYWAY_PASSWORD'] as const;
const TRANSACTION_POOLER_PORT = '6543';
const isWindows = process.platform === 'win32';
const workspaceRoot = fileURLToPath(new URL('..', import.meta.url));

function fail(lines: string[]): never {
  for (const line of lines) console.error(line);
  process.exit(1);
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

// Extracts the port from a JDBC URL such as jdbc:postgresql://host:5432/db?sslmode=require.
function portOf(jdbcUrl: string): string | undefined {
  const match = /^jdbc:[a-z0-9]+:\/\/(?:\[[^\]]+\]|[^/:?#]+)(?::(\d+))?/i.exec(jdbcUrl.trim());
  return match?.[1];
}

function flywayOnPath(): boolean {
  const lookup = spawnSync(isWindows ? 'where' : 'which', ['flyway'], { stdio: 'ignore' });
  return lookup.status === 0;
}

function main(): void {
  const missing = REQUIRED_VARIABLES.filter((name) => isBlank(process.env[name]));
  if (missing.length > 0) {
    fail([
      'Missing required environment variables for Flyway:',
      ...missing.map((name) => `  - ${name}`),
      'Copy .env.example to .env and set every variable listed above.',
    ]);
  }

  const url = process.env['FLYWAY_URL'] ?? '';
  if (portOf(url) === TRANSACTION_POOLER_PORT) {
    fail([
      `FLYWAY_URL uses port ${TRANSACTION_POOLER_PORT}: the Transaction Pooler is not supported.`,
      'Use the Direct connection or the Session Pooler on port 5432 (Flyway needs session-level advisory locks).',
    ]);
  }

  if (!flywayOnPath()) {
    fail([
      'Flyway CLI not found on PATH. Install Flyway (https://documentation.red-gate.com/flyway) and try again.',
    ]);
  }

  // One command string: passing an args array together with `shell: true` is deprecated in Node.js.
  const result = spawnSync('flyway -configFiles=db/flyway.conf migrate', {
    cwd: workspaceRoot,
    stdio: 'inherit',
    shell: true,
  });
  process.exit(result.status ?? 1);
}

main();
