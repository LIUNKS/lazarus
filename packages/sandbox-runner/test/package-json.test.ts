import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string;
  private: boolean;
  type: string;
  engines: { node: string };
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe('package.json', () => {
  it('R1.1 declares the workspace package name, private, ESM, and Node 24', () => {
    expect(pkg).toMatchObject({
      name: '@lazarus/sandbox-runner',
      private: true,
      type: 'module',
      engines: { node: '>=24' },
    });
  });

  it('R1.2 defines the build, test, and lint scripts', () => {
    expect(Object.keys(pkg.scripts).sort()).toEqual(['build', 'lint', 'test']);
    expect(pkg.scripts.test).toBe('vitest run');
  });

  it('R1.6 declares the Verifier and fast-check 4 as dependencies, the bundler and vitest as devDependencies', () => {
    expect(pkg.dependencies['@lazarus/pbt-verifier']).toBe('workspace:*');
    expect(pkg.dependencies['fast-check']).toMatch(/^\^4\./);
    expect(pkg.devDependencies).toHaveProperty('esbuild');
    expect(pkg.devDependencies).toHaveProperty('vitest');
  });
});
