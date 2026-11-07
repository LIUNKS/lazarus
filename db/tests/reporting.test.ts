// Verification_Suite: how the suite reports a missing or unreachable database (Requirements 16.1, 16.2, 16.7, and 16.9).
// Each test starts a child Vitest run of one database test file with a controlled environment.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORKSPACE_ROOT } from './support/env.ts';
import { pnpmExec } from './support/process.ts';

interface Assertion {
  status: string;
  fullName: string;
  failureMessages: string[];
}

function childRun(env: Record<string, string | undefined>): { code: number; assertions: Assertion[] } {
  const dir = mkdtempSync(join(tmpdir(), 'lazarus-child-vitest-'));
  const report = join(dir, 'report.json');
  try {
    const result = pnpmExec(['vitest', 'run', 'db/tests/schema.test.ts', '--reporter=json', `--outputFile=${report}`], {
      env: { ...process.env, TEST_DATABASE_URL: undefined, ...env },
    });
    const json = JSON.parse(readFileSync(report, 'utf8')) as { testResults: Array<{ assertionResults: Assertion[] }> };
    return { code: result.code, assertions: json.testResults.flatMap((file) => file.assertionResults) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('R16 reporting of database availability', () => {
  it('R16.7 reports every database test as skipped, naming the missing variable, when it is unset', () => {
    const { code, assertions } = childRun({});
    expect(code).toBe(0);
    expect(assertions.length).toBeGreaterThan(0);
    for (const assertion of assertions) {
      expect(['pending', 'skipped']).toContain(assertion.status);
      expect(assertion.fullName).toContain('TEST_DATABASE_URL');
    }
  }, 180_000);

  it('R16.9 reports database tests as failed, not skipped, when the connection cannot be made', () => {
    const { code, assertions } = childRun({ TEST_DATABASE_URL: 'postgresql://postgres:x@127.0.0.1:1/unreachable' });
    expect(code).not.toBe(0);
    expect(assertions.length).toBeGreaterThan(0);
    for (const assertion of assertions) {
      expect(assertion.status).toBe('failed');
      expect(assertion.failureMessages.join('\n')).toContain('Database connection failed');
    }
  }, 180_000);

  it('R16.1 exits with a non-zero code when a test fails', () => {
    const { code } = childRun({ TEST_DATABASE_URL: 'postgresql://postgres:x@127.0.0.1:1/unreachable' });
    expect(code).not.toBe(0);
  }, 180_000);
});

describe('R16.2 test naming', () => {
  it('R16.2 every database test title carries a requirement and criterion number, and all of Requirements 8 to 15 are covered', () => {
    const testDir = join(WORKSPACE_ROOT, 'db', 'tests');
    const titles: string[] = [];
    for (const file of readdirSync(testDir).filter((f) => f.endsWith('.test.ts'))) {
      const source = readFileSync(join(testDir, file), 'utf8');
      for (const match of source.matchAll(/\bit(?:\.each\([^)]*\))?\(\s*['"`]([^'"`]+)['"`]/g)) titles.push(match[1] as string);
    }
    const requirements = readFileSync(
      join(WORKSPACE_ROOT, '.kiro', 'specs', '01-lazarus-foundation', 'requirements.md'),
      'utf8',
    );
    expect(existsSync(join(testDir, 'schema.test.ts'))).toBe(true);

    const covered = new Set<string>();
    for (const title of titles) for (const m of title.matchAll(/\bR(\d+)\.(\d+)/g)) covered.add(`${m[1]}.${m[2]}`);

    const sections = requirements.split(/^### Requirement /m).slice(1);
    const missing: string[] = [];
    for (const section of sections) {
      const number = Number(/^(\d+):/.exec(section)?.[1]);
      if (number < 8 || number > 15) continue;
      const criteria = section.split('#### Acceptance Criteria')[1] ?? '';
      for (const line of criteria.split('\n')) {
        const match = /^(\d+)\. /.exec(line);
        if (match && !covered.has(`${number}.${match[1]}`)) missing.push(`${number}.${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
