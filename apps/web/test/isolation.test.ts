// Static isolation checks over the source tree (Requirements 2, 4, 13, and 17).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '../src');

const SERVER_ONLY_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'FLYWAY_URL',
  'FLYWAY_USER',
  'FLYWAY_PASSWORD',
  'TEST_DATABASE_URL',
  'GROQ_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'LLM_MODEL',
  'LLM_FALLBACK_MODEL',
];

// 05-llm-pipeline-api: model settings are read in exactly one module. Only this file may mention the four LLM_Config names.
const LLM_CONFIG_NAMES = ['GROQ_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'LLM_MODEL', 'LLM_FALLBACK_MODEL'];
const LLM_CONFIG_FILE = path.join(SRC, 'lib', 'llm', 'config.ts');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const isTest = (file: string) => /\.test\.(ts|tsx)$/.test(file) || file.includes(`${path.sep}testing${path.sep}`);
const productionFiles = walk(SRC).filter((file) => !isTest(file));
const read = (file: string) => readFileSync(file, 'utf8');
const isClient = (source: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(source);

function resolveImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith('@/') ? path.join(SRC, specifier.slice(2)) : specifier.startsWith('.') ? path.resolve(path.dirname(from), specifier) : null;
  if (!base) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx'), base]) {
    if (productionFiles.includes(candidate)) return candidate;
  }
  return null;
}

function importsOf(file: string): string[] {
  const source = read(file);
  return [...source.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g)]
    .map((m) => m[1] ?? m[2] ?? '')
    .filter(Boolean);
}

function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of importsOf(file)) {
      const target = resolveImport(file, specifier);
      if (target) stack.push(target);
    }
  }
  return seen;
}

describe('R2 server-only isolation (static)', () => {
  it('finds source files to scan', () => {
    expect(productionFiles.length).toBeGreaterThan(20);
    expect(productionFiles.some((file) => isClient(read(file)))).toBe(true);
  });

  it('keeps every Server_Only_Variable name out of Client Components and everything they import', () => {
    for (const entry of productionFiles.filter((file) => isClient(read(file)))) {
      for (const file of reachableFrom(entry)) {
        const source = read(file);
        for (const name of SERVER_ONLY_NAMES) expect(source.includes(name), `${path.relative(SRC, file)} reaches ${name} from a client module`).toBe(false);
      }
    }
  });

  it('never reads the service role key anywhere, and mentions the LLM_Config names only in lib/llm/config.ts', () => {
    for (const file of productionFiles) {
      const source = read(file);
      for (const name of SERVER_ONLY_NAMES) {
        if (file === LLM_CONFIG_FILE && LLM_CONFIG_NAMES.includes(name)) continue;
        expect(source.includes(name), `${path.relative(SRC, file)} mentions ${name}`).toBe(false);
      }
    }
  });

  it('uses no NEXT_PUBLIC_ variable other than the two Public_Config variables', () => {
    const allowed = new Set(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']);
    for (const file of productionFiles) {
      for (const match of read(file).matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) expect(allowed.has(match[0]), `${path.relative(SRC, file)}: ${match[0]}`).toBe(true);
    }
  });
});

describe('R4 and R13 source rules', () => {
  it('imports gsap only from Client Components', () => {
    for (const file of productionFiles) {
      const source = read(file);
      if (/from\s*['"](?:gsap|@gsap\/react)/.test(source)) expect(isClient(source), `${path.relative(SRC, file)} imports gsap`).toBe(true);
    }
  });

  it('never renders user values as HTML', () => {
    for (const file of productionFiles) expect(read(file).includes('dangerouslySetInnerHTML'), path.relative(SRC, file)).toBe(false);
  });

  it('never decides authorization from getSession', () => {
    for (const file of productionFiles) expect(read(file).includes('getSession('), path.relative(SRC, file)).toBe(false);
  });
});

describe('R17 scope (amended by 05-llm-pipeline-api)', () => {
  const LLM_DIR = path.join(SRC, 'lib', 'llm') + path.sep;

  it('imports an LLM SDK only under lib/llm/, and never evaluates or runs code', () => {
    for (const file of productionFiles) {
      const source = read(file);
      if (!file.startsWith(LLM_DIR)) {
        expect(/from\s*['"](?:ai|@ai-sdk\/[^'"]+)['"]/.test(source), `${path.relative(SRC, file)} imports an LLM SDK outside lib/llm`).toBe(false);
      }
      expect(/\b(?:eval|new Function)\s*\(/.test(source), `${path.relative(SRC, file)} evaluates code`).toBe(false);
      expect(/from\s*['"](?:node:vm|vm|acorn)['"]/.test(source), `${path.relative(SRC, file)} parses or runs code`).toBe(false);
    }
  });

  it('has no Route Handler folder under app/api other than scan, seance, and reincarnate', () => {
    const apiDir = path.join(SRC, 'app', 'api');
    const entries = existsSync(apiDir) ? readdirSync(apiDir) : [];
    const allowed = new Set(['scan', 'seance', 'reincarnate']);
    for (const entry of entries) expect(allowed.has(entry), `unexpected app/api/${entry}`).toBe(true);
  });
});