import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as {
  name: string;
  type: string;
  private: boolean;
  main: string;
  types: string;
  engines: { node: string };
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe('package.json', () => {
  it('R1.1 declares the workspace package name, ESM, and private', () => {
    expect(pkg.name).toBe('@lazarus/mcp-curse-scanner');
    expect(pkg.type).toBe('module');
    expect(pkg.private).toBe(true);
  });

  it('R1.2 requires Node 24 or newer', () => {
    expect(pkg.engines.node).toBe('>=24');
  });

  it('R1.6 defines the build, test, and lint scripts', () => {
    expect(pkg.scripts.build).toBe('node scripts/clean.mjs && tsc -p tsconfig.build.json');
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts.lint).toBe('eslint . && tsc --noEmit -p tsconfig.json');
  });

  it('R2.1 points the library entry at dist/lib', () => {
    expect(pkg.main).toBe('./dist/lib.js');
    expect(pkg.types).toBe('./dist/lib.d.ts');
  });

  it('R1.9 declares the runtime dependencies', () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['@modelcontextprotocol/sdk', 'acorn', 'zod']);
  });
});
