// Static isolation checks over the source tree (Requirements 2, 4, 13, and 17).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
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

  it('has no Route Handler folder under app/api other than scan, seance, reincarnate, and verify (amended by 08-live-verification-api)', () => {
    const apiDir = path.join(SRC, 'app', 'api');
    const entries = existsSync(apiDir) ? readdirSync(apiDir) : [];
    const allowed = new Set(['scan', 'seance', 'reincarnate', 'verify']);
    for (const entry of entries) expect(allowed.has(entry), `unexpected app/api/${entry}`).toBe(true);
  });
});

describe('08-live-verification-api boundaries (Requirements 1, 11, and 12)', () => {
  const VERIFICATION_DIR = path.join(SRC, 'lib', 'verification') + path.sep;
  const ENV_SERVER = path.join(SRC, 'lib', 'env-server.ts');
  const SANDBOX_FILE = path.join(SRC, 'lib', 'verification', 'sandbox.ts');
  const ROUTE_FILE = path.join(SRC, 'app', 'api', 'verify', 'route.ts');
  // Pure modules import nothing from the framework and read no environment variable, so they need no server-only import.
  const PURE = new Set(['classify.ts', 'errors.ts', 'flags.ts', 'limits.ts', 'present.ts'].map((name) => VERIFICATION_DIR + name));
  const verificationFiles = productionFiles.filter((file) => file.startsWith(VERIFICATION_DIR));
  const verificationApi = [...verificationFiles, ENV_SERVER, ROUTE_FILE];
  const rel = (file: string) => path.relative(SRC, file).replaceAll('\\', '/');
  const parse = (file: string) => ts.createSourceFile(file, read(file), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

  function nodesOf(file: string, predicate: (node: ts.Node) => boolean): ts.Node[] {
    const found: ts.Node[] = [];
    const visit = (node: ts.Node) => {
      if (predicate(node)) found.push(node);
      ts.forEachChild(node, visit);
    };
    visit(parse(file));
    return found;
  }

  // Static and dynamic import specifiers, read with the parser so a comment never counts.
  function specifiersOf(file: string): string[] {
    const found: string[] = [];
    for (const node of nodesOf(file, () => true)) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) found.push(node.arguments[0].text);
    }
    return found;
  }

  it('R1.3 starts every module of lib/verification and env-server.ts with import server-only, unless the module is pure (Requirement 1)', () => {
    expect(verificationFiles.length).toBeGreaterThanOrEqual(12);
    for (const file of [...verificationFiles, ENV_SERVER]) {
      const first = parse(file).statements[0];
      const startsServerOnly = first !== undefined && ts.isImportDeclaration(first) && ts.isStringLiteral(first.moduleSpecifier) && first.moduleSpecifier.text === 'server-only';
      if (PURE.has(file)) {
        expect(startsServerOnly, `${rel(file)} is pure`).toBe(false);
        expect(read(file).includes('process.env'), `${rel(file)} reads process.env`).toBe(false);
        for (const specifier of specifiersOf(file)) {
          expect(/^(?:next|next\/.*|server-only|@supabase\/.*|@lazarus\/.*)$/.test(specifier), `${rel(file)} imports ${specifier}`).toBe(false);
        }
      } else {
        expect(startsServerOnly, `${rel(file)} starts with import 'server-only'`).toBe(true);
      }
    }
  });

  it('R1.3 imports @lazarus/sandbox-runner only in lib/verification/sandbox.ts (Requirement 1)', () => {
    for (const file of productionFiles) {
      const imports = specifiersOf(file).some((specifier) => specifier === '@lazarus/sandbox-runner' || specifier.startsWith('@lazarus/sandbox-runner/'));
      expect(imports, `${rel(file)} imports @lazarus/sandbox-runner`).toBe(file === SANDBOX_FILE);
    }
  });

  it('R1.4 mentions LAZARUS_SANDBOX_KILL_SWITCH only in lib/env-server.ts, and the Verification_API never names the service role key (Requirement 1)', () => {
    for (const file of productionFiles) {
      expect(read(file).includes('LAZARUS_SANDBOX_KILL_SWITCH'), `${rel(file)} mentions the kill switch`).toBe(file === ENV_SERVER);
    }
    for (const file of verificationApi) expect(read(file).includes('SUPABASE_SERVICE_ROLE_KEY'), rel(file)).toBe(false);
  });

  it('R1.5 reaches no module of lib/verification and not env-server.ts from a Client Component (Requirement 1)', () => {
    for (const entry of productionFiles.filter((file) => isClient(read(file)))) {
      for (const file of reachableFrom(entry)) {
        expect(file.startsWith(VERIFICATION_DIR) || file === ENV_SERVER, `${rel(entry)} reaches ${rel(file)}`).toBe(false);
      }
    }
  });

  it('R1.7 R11.10 imports no verifier, vm, or child process, calls no eval or Function constructor, and has no explicit any (Requirements 1 and 11)', () => {
    for (const file of verificationApi) {
      for (const specifier of specifiersOf(file)) {
        expect(/^(?:@lazarus\/pbt-verifier|node:vm|vm|node:child_process|child_process)$/.test(specifier), `${rel(file)} imports ${specifier}`).toBe(false);
      }
      const evaluates = nodesOf(
        file,
        (node) => (ts.isCallExpression(node) || ts.isNewExpression(node)) && ts.isIdentifier(node.expression) && (node.expression.text === 'eval' || node.expression.text === 'Function'),
      );
      expect(evaluates.length, `${rel(file)} evaluates code`).toBe(0);
      expect(nodesOf(file, (node) => node.kind === ts.SyntaxKind.AnyKeyword).length, `${rel(file)} uses any`).toBe(0);
    }
  });

  it('R1.8 keeps @lazarus/pbt-verifier out of apps/web/package.json (Requirement 1)', () => {
    const pkg = JSON.parse(readFileSync(path.resolve(SRC, '..', 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      expect(Object.keys(pkg[section] ?? {}), section).not.toContain('@lazarus/pbt-verifier');
    }
    expect(pkg['dependencies']?.['@lazarus/sandbox-runner']).toBe('workspace:*');
  });
});
