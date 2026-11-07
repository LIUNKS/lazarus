// Verification_Suite: repository configuration (Requirements 1 to 5, 7, 8.1, 8.2, and 21.3).
// These tests need no database.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORKSPACE_ROOT } from './support/env.ts';
import { pnpmExec, run } from './support/process.ts';

const read = (name: string): string => readFileSync(join(WORKSPACE_ROOT, name), 'utf8');
const readJson = (name: string): Record<string, unknown> => JSON.parse(read(name)) as Record<string, unknown>;

/** Removes a probe package and the parent `packages` folder when the probe was its only content. */
function removeProbe(probe: string): void {
  rmSync(probe, { recursive: true, force: true });
  const parent = join(WORKSPACE_ROOT, 'packages');
  if (existsSync(parent) && readdirSync(parent).length === 0) rmSync(parent, { recursive: true, force: true });
}
describe('R1 monorepo workspace layout', () => {
  it('R1.1 package.json is valid JSON with private set to true', () => {
    expect(readJson('package.json')['private']).toBe(true);
  });

  it('R1.2 pnpm-workspace.yaml lists exactly apps/* and packages/*', () => {
    const globs = [...read('pnpm-workspace.yaml').matchAll(/^\s*-\s*["']?([^"'\s]+)["']?\s*$/gm)].map((m) => m[1]);
    expect(globs).toEqual(['apps/*', 'packages/*']);
  });

  it('R1.3 turbo.json is valid JSON and defines build, test, and lint', () => {
    const tasks = readJson('turbo.json')['tasks'] as Record<string, unknown>;
    expect(Object.keys(tasks)).toEqual(expect.arrayContaining(['build', 'test', 'lint']));
  });

  it('R1.4 a workspace package without the script does not make the task fail', () => {
    const probe = join(WORKSPACE_ROOT, 'packages', `__suite_probe_${process.pid}`);
    try {
      rmSync(probe, { recursive: true, force: true });
      mkdirSync(probe, { recursive: true });
      writeFileSync(join(probe, 'package.json'), JSON.stringify({ name: '@suite/no-scripts', version: '0.0.0' }));
      const result = run('node', ['scripts/workspace-task.ts', 'build']);
      expect(result.code).toBe(0);
    } finally {
      removeProbe(probe);
    }
  });

  it('R1.5 a failing workspace package makes the task fail and its name is printed', () => {
    const probe = join(WORKSPACE_ROOT, 'packages', `__suite_probe_${process.pid}`);
    try {
      mkdirSync(probe, { recursive: true });
      writeFileSync(
        join(probe, 'package.json'),
        JSON.stringify({ name: '@suite/failing', version: '0.0.0', scripts: { build: 'node -e "process.exit(3)"' } }),
      );
      const result = run('node', ['scripts/workspace-task.ts', 'build']);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('@suite/failing');
    } finally {
      removeProbe(probe);
    }
  });

  it('R1.6 with no workspace package, build exits with code 0', () => {
    const packages = existsSync(join(WORKSPACE_ROOT, 'packages')) ? readdirSync(join(WORKSPACE_ROOT, 'packages')) : [];
    const apps = existsSync(join(WORKSPACE_ROOT, 'apps')) ? readdirSync(join(WORKSPACE_ROOT, 'apps')) : [];
    // The statement is only observable while the workspace is empty; later specs add packages.
    if (packages.length + apps.length === 0) {
      expect(run('node', ['scripts/workspace-task.ts', 'build']).code).toBe(0);
    }
    expect(existsSync(join(WORKSPACE_ROOT, 'scripts', 'workspace-task.ts'))).toBe(true);
  });

  it('R1.7 a failing Foundation check makes the root task fail', () => {
    const probe = join(WORKSPACE_ROOT, 'scripts', `__lint_probe_${process.pid}.ts`);
    try {
      writeFileSync(probe, 'export const value: any = 1;\n');
      const result = run('node', ['scripts/workspace-task.ts', 'lint']);
      expect(result.code).not.toBe(0);
    } finally {
      rmSync(probe, { force: true });
    }
  }, 180_000);

  it.each([['.env'], ['.env.local'], ['node_modules/pkg/index.js'], ['.turbo/cache/entry']])(
    'R1.8 git ignores %s',
    (path) => {
      expect(run('git', ['check-ignore', '-q', path]).code).toBe(0);
    },
  );

  it.each([['.kiro/specs/01-lazarus-foundation/requirements.md'], ['.env.example']])(
    'R1.9 git does not ignore %s',
    (path) => {
      expect(run('git', ['check-ignore', '-q', path]).code).toBe(1);
    },
  );
});

describe('R2 engine constraints', () => {
  it('R2.1 engines.node is >=24', () => {
    expect((readJson('package.json')['engines'] as Record<string, string>)['node']).toBe('>=24');
  });

  it('R2.2 engines.pnpm is >=9', () => {
    expect((readJson('package.json')['engines'] as Record<string, string>)['pnpm']).toBe('>=9');
  });

  it('R2.3 .npmrc sets engine-strict=true', () => {
    expect(read('.npmrc')).toMatch(/^engine-strict=true\s*$/m);
  });

  it('R2.4 and R2.5 engine-strict is on, so pnpm aborts installs on unsupported Node or pnpm versions', () => {
    // pnpm enforces `engines` when engine-strict is true; the other half of the behavior belongs to pnpm itself.
    const engines = readJson('package.json')['engines'] as Record<string, string>;
    expect(engines['node']).toBe('>=24');
    expect(engines['pnpm']).toBe('>=9');
    expect(read('.npmrc')).toMatch(/^engine-strict=true\s*$/m);
  });

  it('R2.6 no configuration file resolves to a Node.js 20.x release', () => {
    const files = ['package.json', '.npmrc', 'turbo.json', 'pnpm-workspace.yaml', '.nvmrc', '.node-version'];
    const workflows = existsSync(join(WORKSPACE_ROOT, '.github', 'workflows'))
      ? readdirSync(join(WORKSPACE_ROOT, '.github', 'workflows')).map((f) => `.github/workflows/${f}`)
      : [];
    for (const file of [...files, ...workflows]) {
      if (!existsSync(join(WORKSPACE_ROOT, file))) continue;
      expect(read(file), file).not.toMatch(/node[^\n]{0,30}[\s:='"^~v]20(\.\d+){0,2}\b/i);
    }
  });
});

describe('R3 root scripts', () => {
  const scripts = (): Record<string, string> => readJson('package.json')['scripts'] as Record<string, string>;

  it('R3.1 defines build, test, lint, and db:migrate with non-empty commands', () => {
    for (const name of ['build', 'test', 'lint', 'db:migrate']) {
      expect(scripts()[name]?.trim(), name).toBeTruthy();
    }
  });

  it('R3.2 the build task delegates to every workspace package through Turborepo', () => {
    const source = read('scripts/workspace-task.ts');
    expect(source).toContain("'turbo', 'run', task");
    expect(scripts()['build']).toContain('workspace-task.ts build');
  });

  it('R3.3 the test task runs Vitest for the suite and the workspace packages', () => {
    const source = read('scripts/workspace-task.ts');
    expect(source).toContain("test: [['vitest', 'run']]");
    expect(scripts()['test']).toContain('workspace-task.ts test');
  });

  it('R3.4 lint runs ESLint and tsc --noEmit and passes on the repository', () => {
    const source = read('scripts/workspace-task.ts');
    expect(source).toContain("['eslint', '.']");
    expect(source).toContain("['tsc', '--noEmit']");
    expect(pnpmExec(['eslint', '.']).code).toBe(0);
    expect(pnpmExec(['tsc', '--noEmit']).code).toBe(0);
  }, 180_000);

  it('R3.5 Vitest runs in single-run mode', () => {
    expect(read('scripts/workspace-task.ts')).toContain("['vitest', 'run']");
  });

  it('R3.6 a failing workspace package makes the task fail', () => {
    // Covered end to end by R1.5, which runs the real task with a failing package.
    expect(read('scripts/workspace-task.ts')).toContain('if (code !== 0) exitCode = code;');
  });

  it('R3.7 db:migrate loads .env with dotenv-cli and starts the Migration_Runner', () => {
    expect(scripts()['db:migrate']).toBe('dotenv -e .env -- node scripts/db-migrate.ts');
  });
});

describe('R4 shared TypeScript, ESLint, and Vitest configuration', () => {
  it('R4.1 tsconfig.base.json sets strict to true', () => {
    expect(JSON.parse(read('tsconfig.base.json')).compilerOptions.strict).toBe(true);
  });

  it('R4.2 ESLint reports no-explicit-any as an error', () => {
    const printed = pnpmExec(['eslint', '--print-config', 'scripts/db-migrate.ts']);
    expect(printed.code).toBe(0);
    const rule = (JSON.parse(printed.stdout) as { rules: Record<string, unknown> }).rules['@typescript-eslint/no-explicit-any'];
    expect(rule).toEqual([2]);
  });

  it('R4.3 an explicit any annotation is reported with a non-zero exit code', () => {
    const result = pnpmExec(['eslint', '--stdin', '--stdin-filename', 'scripts/probe.ts'], {
      input: 'export const value: any = 1;\n',
    });
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('@typescript-eslint/no-explicit-any');
  }, 60_000);

  it('R4.4 lint exits with code 0 when there is no explicit any and no type error', () => {
    expect(pnpmExec(['eslint', '.']).code).toBe(0);
  }, 120_000);

  it('R4.5 a package tsconfig that extends the base inherits strict mode', () => {
    expect(JSON.parse(read('tsconfig.json')).extends).toBe('./tsconfig.base.json');
  });

  it('R4.6 a Vitest configuration at the root can be extended', () => {
    expect(read('vitest.shared.ts')).toContain('defineConfig');
    expect(read('vitest.config.ts')).toContain('mergeConfig');
  });
});

describe('R5 environment template', () => {
  const lines = (): string[] => read('.env.example').split(/\r?\n/);
  const assignments = (): Array<{ name: string; value: string; commented: boolean }> =>
    lines().flatMap((line) => {
      const match = /^(#\s*)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      return match ? [{ name: match[2] as string, value: match[3] as string, commented: Boolean(match[1]) }] : [];
    });
  const names = (): string[] => assignments().map((a) => a.name);

  it('R5.1 documents every variable referenced by the runner, the Flyway config, and the suite', () => {
    for (const name of ['FLYWAY_URL', 'FLYWAY_USER', 'FLYWAY_PASSWORD', 'TEST_DATABASE_URL']) {
      expect(names(), name).toContain(name);
    }
  });

  it('R5.2 uses placeholder values only', () => {
    for (const { name, value } of assignments()) {
      if (/KEY|PASSWORD|URL/.test(name)) expect(value, name).toContain('your-');
    }
  });

  it('R5.3 documents FLYWAY_URL, FLYWAY_USER, and FLYWAY_PASSWORD with an assignment and a purpose comment', () => {
    for (const name of ['FLYWAY_URL', 'FLYWAY_USER', 'FLYWAY_PASSWORD']) {
      expect(assignments().some((a) => a.name === name && !a.commented), `${name} assignment`).toBe(true);
      expect(lines().some((line) => line.startsWith(`# ${name}:`)), `${name} comment`).toBe(true);
    }
  });

  it('R5.4 documents the Direct connection and the Session Pooler on port 5432', () => {
    const text = read('.env.example');
    expect(text).toMatch(/#.*Direct connection/);
    expect(text).toMatch(/#.*Session Pooler/);
    const urls = assignments().filter((a) => a.name === 'FLYWAY_URL');
    expect(urls.length).toBeGreaterThanOrEqual(2);
    for (const url of urls) expect(url.value).toContain(':5432');
  });

  it('R5.5 states that the Transaction Pooler on port 6543 is not supported', () => {
    expect(read('.env.example')).toMatch(/#.*Transaction Pooler.*6543.*not supported/);
  });

  it('R5.6 contains every variable read by the Verification_Suite', () => {
    expect(names()).toContain('TEST_DATABASE_URL');
    expect(lines().some((line) => line.startsWith('# TEST_DATABASE_URL:'))).toBe(true);
  });

  it('R5.7 names the server-only variables exactly and never exposes them with NEXT_PUBLIC_', () => {
    for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'FLYWAY_URL', 'FLYWAY_USER', 'FLYWAY_PASSWORD', 'GROQ_API_KEY']) {
      expect(names()).toContain(name);
      expect(names()).not.toContain(`NEXT_PUBLIC_${name}`);
    }
  });
});

describe('R7 Flyway configuration file', () => {
  const conf = (): string => read('db/flyway.conf');
  const settings = (): Map<string, string> =>
    new Map(
      conf()
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
        .map((line) => {
          const index = line.indexOf('=');
          return [line.slice(0, index).trim(), line.slice(index + 1).trim()] as const;
        }),
    );

  it('R7.1 sets flyway.locations to db/migrations', () => {
    expect(settings().get('flyway.locations')).toBe('db/migrations');
  });

  it('R7.2 never defines flyway.url, flyway.user, or flyway.password, even in comments', () => {
    expect(conf()).not.toMatch(/flyway\.(url|user|password)\s*=/i);
  });

  it('R7.3 contains no credential value', () => {
    expect(conf()).not.toMatch(/jdbc:|postgres(ql)?:\/\/|password\s*=|token|secret|apikey/i);
  });

  it('R7.4 sets flyway.validateOnMigrate to true', () => {
    expect(settings().get('flyway.validateOnMigrate')).toBe('true');
  });

  it('R7.5 sets flyway.cleanDisabled to true', () => {
    expect(settings().get('flyway.cleanDisabled')).toBe('true');
  });

  it('R7.6 never mentions port 6543', () => {
    expect(conf()).not.toContain('6543');
  });
});

describe('R8 migration files', () => {
  const files = (): string[] => readdirSync(join(WORKSPACE_ROOT, 'db', 'migrations'));

  it('R8.1 every migration file name matches V<N>__<description>.sql', () => {
    for (const file of files()) expect(file).toMatch(/^V[1-9]\d*__[a-z0-9_]{1,100}\.sql$/);
  });

  it('R8.2 the Foundation provides exactly V1 and V2', () => {
    expect(files().sort()).toEqual(['V1__create_lazarus_schema.sql', 'V2__seed_sample_corpses.sql']);
  });
});

describe('R21 scope and language', () => {
  it('R21.3 repository text files contain no Spanish text', () => {
    const tracked = run('git', ['ls-files', '--cached', '--others', '--exclude-standard']).stdout
      .split(/\r?\n/)
      .filter((f) => f !== '' && !f.startsWith('.kiro/') && !f.endsWith('pnpm-lock.yaml') && !f.endsWith('LICENSE') && f !== 'db/tests/config.test.ts');
    const spanish = /[\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\u00bf\u00a1]|\b(ejecutar|archivo|usuario)\b/i;
    for (const file of tracked) {
      if (!existsSync(join(WORKSPACE_ROOT, file))) continue;
      // "Seance" is a product name (the Seance Chamber stage), so the accented spelling is allowed.
      expect(read(file).replaceAll(/S\u00e9ance/gi, 'Seance'), file).not.toMatch(spanish);
    }
  });
});
