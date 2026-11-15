// PostTaskExec hook (see .kiro/hooks/verify-after-task.json).
// Runs `pnpm lint` for the whole workspace, then `pnpm test` only for the packages under packages/ that have
// uncommitted changes. apps/web and db tests are left out on purpose: the web build test is slow and the db
// tests need a database, so run those by hand at the checkpoint tasks of each spec.
// Exit code 1 when any step fails, so the failure is visible in the hook log.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function run(label, command, args) {
  process.stdout.write(`\n== ${label}\n`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  return result.status === 0;
}

function changedPackages() {
  const result = spawnSync('git', ['status', '--porcelain', '--', 'packages'], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  const names = new Set();
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = /^.{2,3}"?packages\/([^/"]+)\//.exec(line);
    if (match && existsSync(join('packages', match[1], 'package.json'))) names.add(match[1]);
  }
  return [...names].sort();
}

let ok = run('pnpm lint', 'pnpm', ['lint']);
for (const name of changedPackages()) {
  ok = run(`pnpm test (packages/${name})`, 'pnpm', ['--filter', `./packages/${name}`, 'test']) && ok;
}
process.stdout.write(ok ? '\nTask verification passed.\n' : '\nTask verification FAILED. Fix it before starting the next task.\n');
process.exit(ok ? 0 : 1);
