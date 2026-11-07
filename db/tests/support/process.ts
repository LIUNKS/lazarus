// Small process helpers shared by the static tests.
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { WORKSPACE_ROOT } from './env.ts';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  output: string;
}

/** Quotes one argument for cmd.exe. Arguments made of safe characters are left untouched. */
export function quoteArg(argument: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(argument) ? argument : `"${argument.replace(/"/g, '\\"')}"`;
}

/**
 * Runs a command and captures its output.
 * On Windows the command goes through the shell as ONE string, because passing an args array
 * together with `shell: true` is deprecated in Node.js.
 */
export function run(command: string, args: string[], options: SpawnSyncOptions = {}): RunResult {
  const settings: SpawnSyncOptions = { cwd: WORKSPACE_ROOT, encoding: 'utf8', ...options };
  const result =
    process.platform === 'win32'
      ? spawnSync([command, ...args.map(quoteArg)].join(' '), { ...settings, shell: true })
      : spawnSync(command, args, settings);
  const stdout = String(result.stdout ?? '');
  const stderr = String(result.stderr ?? '');
  return { code: result.status ?? 1, stdout, stderr, output: `${stdout}${stderr}${result.error?.message ?? ''}` };
}

export function pnpmExec(args: string[], options: SpawnSyncOptions = {}): RunResult {
  return run('pnpm', ['exec', ...args], options);
}