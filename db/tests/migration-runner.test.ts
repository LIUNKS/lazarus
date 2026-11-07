// Verification_Suite: the Migration_Runner (Requirement 6). A fake Flyway executable replaces the real one,
// so these tests need no database. The fake records its arguments and exits with a code chosen by the test.
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WORKSPACE_ROOT } from './support/env.ts';
import { run } from './support/process.ts';

const PASSWORD = 'pw-never-print-this-7f3a';
const VALID_ENV = {
  FLYWAY_URL: 'jdbc:postgresql://db.example.test:5432/postgres',
  FLYWAY_USER: 'postgres',
  FLYWAY_PASSWORD: PASSWORD,
};

let fakeBin = '';
let callLog = '';

function fakeFlywayScript(): { name: string; body: string } {
  if (process.platform === 'win32') {
    return {
      name: 'flyway.cmd',
      body: '@echo off\r\necho %* >> "%FAKE_FLYWAY_LOG%"\r\nexit /b %FAKE_FLYWAY_EXIT%\r\n',
    };
  }
  return { name: 'flyway', body: '#!/bin/sh\necho "$@" >> "$FAKE_FLYWAY_LOG"\nexit "${FAKE_FLYWAY_EXIT:-0}"\n' };
}

beforeAll(() => {
  fakeBin = mkdtempSync(join(tmpdir(), 'lazarus-fake-flyway-'));
  callLog = join(fakeBin, 'calls.log');
  const { name, body } = fakeFlywayScript();
  writeFileSync(join(fakeBin, name), body);
  chmodSync(join(fakeBin, name), 0o755);
});

afterAll(() => {
  rmSync(fakeBin, { recursive: true, force: true });
});

function systemPath(): string {
  const root = process.env['SystemRoot'];
  return root ? `${join(root, 'System32')}` : '/usr/bin:/bin';
}

function runner(
  env: Record<string, string | undefined>,
  options: { withFakeFlyway?: boolean; exitCode?: number } = {},
): { code: number; output: string; calls: string[] } {
  rmSync(callLog, { force: true });
  const base = options.withFakeFlyway === false ? '' : fakeBin;
  const path = [base, dirname(process.execPath), systemPath()].filter(Boolean).join(delimiter);
  const result = run('node', ['scripts/db-migrate.ts'], {
    env: {
      ...process.env,
      PATH: path,
      Path: path,
      FLYWAY_URL: undefined,
      FLYWAY_USER: undefined,
      FLYWAY_PASSWORD: undefined,
      ...env,
      FAKE_FLYWAY_LOG: callLog,
      FAKE_FLYWAY_EXIT: String(options.exitCode ?? 0),
    },
  });
  const calls = existsSync(callLog) ? readFileSync(callLog, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  return { code: result.code, output: result.output, calls };
}

describe('R6 Migration_Runner', () => {
  it('R6.1 loads .env with dotenv-cli and runs flyway exactly once with the project config', () => {
    const envFile = join(fakeBin, 'test.env');
    writeFileSync(envFile, Object.entries(VALID_ENV).map(([k, v]) => `${k}=${v}`).join('\n'));
    rmSync(callLog, { force: true });
    const path = [fakeBin, dirname(process.execPath), systemPath()].join(delimiter);
    const result = run('pnpm', ['exec', 'dotenv', '-e', envFile, '--', 'node', 'scripts/db-migrate.ts'], {
      env: { ...process.env, PATH: path, Path: path, FAKE_FLYWAY_LOG: callLog, FAKE_FLYWAY_EXIT: '0' },
    });
    const calls = existsSync(callLog) ? readFileSync(callLog, 'utf8').split(/\r?\n/).filter(Boolean) : [];
    expect(result.code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('-configFiles=db/flyway.conf');
    expect(calls[0]).toContain('migrate');
  });

  it('R6.2 lists dotenv-cli as a devDependency', () => {
    const manifest = JSON.parse(readFileSync(join(WORKSPACE_ROOT, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    expect(manifest.devDependencies['dotenv-cli']).toBeTruthy();
  });

  it.each(['FLYWAY_URL', 'FLYWAY_USER', 'FLYWAY_PASSWORD'])(
    'R6.3 exits non-zero before flyway and names %s when it is unset, empty, or blank',
    (name) => {
      for (const blank of [undefined, '', '   ']) {
        const result = runner({ ...VALID_ENV, [name]: blank });
        expect(result.code, `${name}=${JSON.stringify(blank)}`).not.toBe(0);
        expect(result.output).toContain(name);
        expect(result.calls).toHaveLength(0);
        expect(result.output).not.toContain(PASSWORD);
      }
    },
  );

  it('R6.3 names each missing variable once, one per line, without values', () => {
    const result = runner({});
    const listed = result.output.split(/\r?\n/).filter((line) => /^\s+- FLYWAY_/.test(line));
    expect(listed.map((line) => line.trim())).toEqual(['- FLYWAY_URL', '- FLYWAY_USER', '- FLYWAY_PASSWORD']);
  });

  it('R6.4 rejects the Transaction Pooler port 6543 before flyway', () => {
    const result = runner({ ...VALID_ENV, FLYWAY_URL: 'jdbc:postgresql://pooler.example.test:6543/postgres?sslmode=require' });
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('Transaction Pooler');
    expect(result.calls).toHaveLength(0);
    expect(result.output).not.toContain(PASSWORD);
  });

  it('R6.5 reports Flyway as the missing prerequisite when it is not on PATH', () => {
    const result = runner(VALID_ENV, { withFakeFlyway: false });
    const flywayInstalledElsewhere = run(process.platform === 'win32' ? 'where' : 'which', ['flyway'], {
      env: { ...process.env, PATH: [dirname(process.execPath), systemPath()].join(delimiter) },
    }).code === 0;
    if (!flywayInstalledElsewhere) {
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('Flyway');
      expect(result.output).not.toContain(PASSWORD);
    }
  });

  it('R6.6 never prints the Flyway password, including when Flyway fails', () => {
    const failing = runner(VALID_ENV, { exitCode: 5 });
    expect(failing.output).not.toContain(PASSWORD);
    const badPort = runner({ ...VALID_ENV, FLYWAY_URL: 'jdbc:postgresql://h:6543/db' });
    expect(badPort.output).not.toContain(PASSWORD);
  });

  it('R6.7 exits with the exit code of the Flyway process', () => {
    expect(runner(VALID_ENV, { exitCode: 0 }).code).toBe(0);
    expect(runner(VALID_ENV, { exitCode: 7 }).code).toBe(7);
  });
});
