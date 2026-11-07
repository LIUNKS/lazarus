// Test database setup: starts or stops the disposable Docker Postgres and runs the suite against it.
// Usage: node scripts/test-db.ts <up | down | run>
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LOCAL_DATABASE_URL = 'postgresql://postgres:lazarus_local@localhost:54329/lazarus_test';
const workspaceRoot = fileURLToPath(new URL('..', import.meta.url));

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): number {
  // One command string: passing an args array together with shell: true is deprecated in Node.js.
  const result = spawnSync([command, ...args].join(' '), {
    cwd: workspaceRoot,
    stdio: 'inherit',
    shell: true,
    env,
  });
  if (result.error) {
    console.error(`Could not run "${command}": ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const compose = ['compose', '-f', 'db/local/docker-compose.yml'];

function up(): number {
  return run('docker', [...compose, 'up', '-d', '--wait']);
}

function down(): number {
  return run('docker', [...compose, 'down', '-v']);
}

const command = process.argv[2];
switch (command) {
  case 'up':
    process.exit(up());
    break;
  case 'down':
    process.exit(down());
    break;
  case 'run': {
    const upCode = up();
    if (upCode !== 0) process.exit(upCode);
    const env = { ...process.env, TEST_DATABASE_URL: process.env['TEST_DATABASE_URL'] ?? LOCAL_DATABASE_URL };
    process.exit(run('pnpm', ['exec', 'vitest', 'run'], env));
    break;
  }
  default:
    console.error('Usage: node scripts/test-db.ts <up | down | run>');
    process.exit(2);
}
