// Runs one root task (build, test, or lint).
//
// 1. Runs the Foundation's own checks for the task.
// 2. Runs the task of every workspace package that defines it through Turborepo.
//    `turbo run` fails when no package defines the task, so it is skipped in that case.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Task = 'build' | 'test' | 'lint';

const FOUNDATION_CHECKS: Record<Task, string[][]> = {
  // No Foundation build step: there is nothing to compile at the root.
  build: [],
  test: [['vitest', 'run']],
  lint: [['eslint', '.'], ['tsc', '--noEmit']],
};

const root = process.cwd();

function run(args: string[]): number {
  // One command string: passing an args array together with shell: true is deprecated in Node.js.
  const result = spawnSync(['pnpm', 'exec', ...args].join(' '), {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });
  return result.status ?? 1;
}

function packagesDefining(task: Task): string[] {
  const names: string[] = [];
  for (const group of ['apps', 'packages']) {
    const groupDir = join(root, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(groupDir, entry.name, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        name?: string;
        scripts?: Record<string, string>;
      };
      if (manifest.scripts?.[task]) names.push(manifest.name ?? `${group}/${entry.name}`);
    }
  }
  return names;
}

const task = process.argv[2];
if (task !== 'build' && task !== 'test' && task !== 'lint') {
  console.error(`Unknown task "${String(task)}". Expected build, test, or lint.`);
  process.exit(2);
}

let exitCode = 0;
for (const check of FOUNDATION_CHECKS[task]) {
  const code = run(check);
  if (code !== 0) {
    console.error(`Foundation check failed: ${check.join(' ')} (exit code ${code})`);
    exitCode = code;
  }
}

const packages = packagesDefining(task);
if (packages.length > 0) {
  const code = run(['turbo', 'run', task]);
  if (code !== 0) exitCode = code;
} else {
  console.log(`No workspace package defines "${task}"; skipping Turborepo.`);
}

process.exit(exitCode);
