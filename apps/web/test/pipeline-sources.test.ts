// Source-scan tests for the Pipeline_API (Requirements 1, 2, 5, 12, 15, 16, and 20). They read the production source
// files with the TypeScript parser, so a comment that mentions `any` or `eval` is never mistaken for code.
// The amended isolation.test.ts is not edited: it keeps its own checks, and this file adds the Pipeline_API ones.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const APP = path.resolve(import.meta.dirname, '..');
const SRC = path.join(APP, 'src');
const ROOT = path.resolve(APP, '../..');
const LLM_DIR = path.join(SRC, 'lib', 'llm');
const PIPELINE_DIR = path.join(SRC, 'lib', 'pipeline');
const API_DIR = path.join(SRC, 'app', 'api');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

// Test files and the test-only doubles under lib/testing are not production code (isolation.test.ts excludes them too).
const isTestFile = (file: string) => /\.test\.(ts|tsx)$/.test(file) || file.includes(`${path.sep}testing${path.sep}`);
const production = (dir: string) => walk(dir).filter((file) => !isTestFile(file));
const pipelineFiles = [...production(LLM_DIR), ...production(PIPELINE_DIR)];
const apiFiles = production(API_DIR);
const allPipelineApi = [...pipelineFiles, ...apiFiles];
const rel = (file: string) => path.relative(SRC, file).replaceAll('\\', '/');
const parse = (file: string) => ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

function importSpecifiers(source: ts.SourceFile): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) found.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function nodesOf(source: ts.SourceFile, predicate: (node: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

// Pure modules: no server-only import, no framework or SDK import, no process.env (Requirement 1 criterion 3).
const PURE_MODULES = new Set(
  [
    'lib/llm/schemas.ts',
    'lib/pipeline/types.ts',
    'lib/pipeline/limits.ts',
    'lib/pipeline/errors.ts',
    'lib/pipeline/forbidden.ts',
    'lib/pipeline/preflight.ts',
    'lib/pipeline/count-lines.ts',
    'lib/pipeline/eligibility.ts',
    'lib/pipeline/cache-select.ts',
    'lib/pipeline/call-policy.ts',
    'lib/pipeline/prompts.ts',
    'lib/pipeline/seance-validate.ts',
    'lib/pipeline/static-gate.ts',
    'lib/pipeline/present.ts',
  ].map((name) => name),
);
const FRAMEWORK_IMPORT = /^(?:ai|next|next\/.*|server-only|@ai-sdk\/.*)$/;

describe('R1 module layout and the server-only boundary (Requirement 1)', () => {
  it('R1.2 each route file exports exactly the allowed names, with runtime nodejs, dynamic force-dynamic, and maxDuration of at least 120 for the LLM routes only (Requirement 1)', () => {
    const expected: Record<string, string[]> = {
      scan: ['POST', 'dynamic', 'runtime'],
      seance: ['POST', 'dynamic', 'maxDuration', 'runtime'],
      reincarnate: ['POST', 'dynamic', 'maxDuration', 'runtime'],
    };
    for (const [name, exports] of Object.entries(expected)) {
      const file = path.join(API_DIR, name, 'route.ts');
      const source = parse(file);
      const exported: string[] = [];
      const values = new Map<string, ts.Expression | undefined>();
      for (const statement of source.statements) {
        const isExported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (!isExported) continue;
        if (ts.isFunctionDeclaration(statement) && statement.name) exported.push(statement.name.text);
        else if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name)) {
              exported.push(declaration.name.text);
              values.set(declaration.name.text, declaration.initializer);
            }
          }
        } else exported.push(`<${ts.SyntaxKind[statement.kind]}>`);
      }
      expect(exported.sort(), name).toEqual(exports);
      expect(values.get('runtime') && ts.isStringLiteral(values.get('runtime') as ts.Expression) && (values.get('runtime') as ts.StringLiteral).text, name).toBe('nodejs');
      expect(values.get('dynamic') && ts.isStringLiteral(values.get('dynamic') as ts.Expression) && (values.get('dynamic') as ts.StringLiteral).text, name).toBe('force-dynamic');
      if (name !== 'scan') {
        const max = values.get('maxDuration');
        expect(max && ts.isNumericLiteral(max) && Number(max.text) >= 120, `${name} maxDuration`).toBe(true);
      }
    }
  });

  it('R1.2 has no Route Handler folder under app/api other than scan, seance, and reincarnate (Requirement 1)', () => {
    expect(readdirSync(API_DIR).sort()).toEqual(['reincarnate', 'scan', 'seance']);
    expect(apiFiles.map(rel).sort()).toEqual(['app/api/reincarnate/route.ts', 'app/api/scan/route.ts', 'app/api/seance/route.ts']);
  });

  it('R1.3 starts every non-pure module with import server-only, and keeps pure modules free of framework imports and process.env (Requirement 1)', () => {
    const modules = pipelineFiles.map((file) => ({ file, name: rel(file) }));
    expect(modules.length).toBeGreaterThan(20);
    for (const { file, name } of modules) {
      const source = parse(file);
      const text = readFileSync(file, 'utf8');
      const imports = importSpecifiers(source);
      if (PURE_MODULES.has(name)) {
        expect(imports.filter((specifier) => FRAMEWORK_IMPORT.test(specifier)), `${name} is pure`).toEqual([]);
        expect(/process\.env/.test(text), `${name} reads process.env`).toBe(false);
      } else {
        const first = source.statements.find(ts.isImportDeclaration);
        expect(first && ts.isStringLiteral(first.moduleSpecifier) && first.moduleSpecifier.text, `${name} starts with server-only`).toBe('server-only');
        // The first import is a bare side-effect import, written as the first statement of the file.
        expect(first && !first.importClause, name).toBe(true);
        expect(source.statements[0], name).toBe(first);
      }
    }
    for (const name of PURE_MODULES) expect(pipelineFiles.map(rel), name).toContain(name);
  });

  it('R1.4 imports ai and the AI SDK providers only under lib/llm, and only generate.ts uses them (Requirement 1)', () => {
    const importers = production(SRC)
      .filter((file) => importSpecifiers(parse(file)).some((specifier) => specifier === 'ai' || specifier.startsWith('ai/') || specifier.startsWith('@ai-sdk/')))
      .map(rel);
    expect(importers).toEqual(['lib/llm/generate.ts']);
  });

  it('R1.5 reads the LLM variables only in lib/llm/config.ts, and never mentions the service role key (Requirement 1)', () => {
    for (const file of production(SRC)) {
      const text = readFileSync(file, 'utf8');
      expect(text.includes('SUPABASE_SERVICE_ROLE_KEY'), rel(file)).toBe(false);
      if (rel(file) === 'lib/llm/config.ts') continue;
      for (const name of ['GROQ_API_KEY', 'LLM_MODEL', 'GOOGLE_GENERATIVE_AI_API_KEY', 'LLM_FALLBACK_MODEL']) expect(text.includes(name), `${rel(file)} mentions ${name}`).toBe(false);
    }
    const config = readFileSync(path.join(LLM_DIR, 'config.ts'), 'utf8');
    for (const name of ['GROQ_API_KEY', 'LLM_MODEL', 'GOOGLE_GENERATIVE_AI_API_KEY', 'LLM_FALLBACK_MODEL']) expect(config.includes(name)).toBe(true);
  });

  it('R1.6 creates no Supabase client in the pipeline or the gateway, so the request client is the only one (Requirement 1)', () => {
    for (const file of allPipelineApi) {
      const source = parse(file);
      const calls = nodesOf(source, (node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^(?:createClient|createServerClient|createBrowserClient)$/.test(node.expression.text));
      // deps.ts is the one place that creates the Server_Client of the request, once per request.
      const allowed = rel(file) === 'lib/pipeline/deps.ts' ? 1 : 0;
      expect(calls.length, rel(file)).toBe(allowed);
      // Only the store and the quota wrapper import the Supabase client library, and only for its type.
      const supabaseImports = importSpecifiers(source).filter((specifier) => specifier === '@supabase/supabase-js' || specifier === '@supabase/ssr');
      if (supabaseImports.length > 0) expect(['lib/pipeline/store.ts', 'lib/pipeline/quota.ts'], rel(file)).toContain(rel(file));
    }
  });

  it('R1.8 contains no explicit any type in the Pipeline_API files (Requirement 1)', () => {
    for (const file of allPipelineApi) {
      const any = nodesOf(parse(file), (node) => node.kind === ts.SyntaxKind.AnyKeyword);
      expect(any.length, rel(file)).toBe(0);
    }
  });

  it('R1.10 reaches no lib/llm or lib/pipeline module from a Client Component (Requirement 1)', () => {
    const files = production(SRC);
    const byPath = new Set(files);
    const isClient = (text: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(text);
    const resolve = (from: string, specifier: string): string | null => {
      const base = specifier.startsWith('@/') ? path.join(SRC, specifier.slice(2)) : specifier.startsWith('.') ? path.resolve(path.dirname(from), specifier) : null;
      if (base === null) return null;
      return [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx'), base].find((candidate) => byPath.has(candidate)) ?? null;
    };
    const clients = files.filter((file) => isClient(readFileSync(file, 'utf8')));
    expect(clients.length).toBeGreaterThan(0);
    for (const entry of clients) {
      const seen = new Set<string>();
      const stack = [entry];
      while (stack.length > 0) {
        const file = stack.pop() as string;
        if (seen.has(file)) continue;
        seen.add(file);
        for (const specifier of importSpecifiers(parse(file))) {
          const target = resolve(file, specifier);
          if (target) stack.push(target);
        }
      }
      for (const reached of seen) {
        expect(reached.startsWith(LLM_DIR) || reached.startsWith(PIPELINE_DIR), `${rel(entry)} reaches ${rel(reached)}`).toBe(false);
      }
    }
  });
});

describe('R5 R12 R15 R16 R20 code that is never run (Requirements 5, 12, 15, 16, and 20)', () => {
  it('R12.9 R20.10 imports no verifier, vm, or child process, and calls no eval or Function constructor (Requirement 12 and 20)', () => {
    for (const file of allPipelineApi) {
      const source = parse(file);
      for (const specifier of importSpecifiers(source)) {
        expect(/^(?:@lazarus\/pbt-verifier|node:vm|vm|node:child_process|child_process|acorn)$/.test(specifier), `${rel(file)} imports ${specifier}`).toBe(false);
      }
      const evaluates = nodesOf(
        source,
        (node) =>
          ((ts.isCallExpression(node) || ts.isNewExpression(node)) && ts.isIdentifier(node.expression) && (node.expression.text === 'eval' || node.expression.text === 'Function')) ||
          (ts.isIdentifier(node) && node.text === 'setTimeout' && ts.isCallExpression(node.parent) && node.parent.arguments[0] !== undefined && ts.isStringLiteral(node.parent.arguments[0])),
      );
      expect(evaluates.length, rel(file)).toBe(0);
    }
  });

  it('R5.7 R12.9 never decides access from getSession (Requirement 5)', () => {
    for (const file of allPipelineApi) {
      expect(nodesOf(parse(file), (node) => ts.isIdentifier(node) && node.text === 'getSession').length, rel(file)).toBe(0);
    }
  });

  it('R15.1 R16.4 gives the AI SDK call no tools key, so the tool set is empty (Requirement 15 and 16)', () => {
    const source = parse(path.join(LLM_DIR, 'generate.ts'));
    const calls = nodesOf(source, (node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'generateText');
    expect(calls).toHaveLength(1);
    const options = (calls[0] as ts.CallExpression).arguments[0] as ts.ObjectLiteralExpression;
    const keys = options.properties.map((property) => (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property) ? property.name.getText() : '...spread'));
    expect(keys).not.toContain('tools');
    expect(keys).not.toContain('activeTools');
    expect(keys).toEqual(expect.arrayContaining(['model', 'instructions', 'prompt', 'output', 'temperature', 'maxOutputTokens', 'maxRetries', 'abortSignal']));
  });
});

describe('R2 R1 configuration files (Requirements 1 and 2)', () => {
  const RETIRED = 'llama-3.3-70b-versatile';

  it('R2.8 keeps the retired model id out of every production file except the comparison constant in lib/llm/config.ts (Requirement 2)', () => {
    const holders = production(SRC).filter((file) => readFileSync(file, 'utf8').toLowerCase().includes(RETIRED));
    expect(holders.map(rel)).toEqual(['lib/llm/config.ts']);
    const config = parse(path.join(LLM_DIR, 'config.ts'));
    const literals = nodesOf(config, (node) => ts.isStringLiteral(node) && node.text.toLowerCase() === RETIRED);
    expect(literals).toHaveLength(1);
    // It is the value of one constant, never a default of readLlmConfig and never sent to a provider.
    expect(literals[0]!.parent.kind).toBe(ts.SyntaxKind.VariableDeclaration);
    expect((literals[0]!.parent as ts.VariableDeclaration).name.getText()).toBe('RETIRED_MODEL');
  });

  it('R2.8 R2.10 names the retired id in .env.example only on comment lines, and documents the four variables (Requirement 2)', () => {
    const lines = readFileSync(path.join(ROOT, '.env.example'), 'utf8').split(/\r?\n/);
    for (const line of lines.filter((text) => text.toLowerCase().includes(RETIRED))) expect(line.trimStart().startsWith('#'), line).toBe(true);
    expect(lines.some((line) => !line.trimStart().startsWith('#') && /=.*llama/i.test(line))).toBe(false);

    const find = (name: string) => lines.findIndex((line) => line.replace(/^#\s*/, '').startsWith(`${name}=`));
    for (const name of ['GROQ_API_KEY', 'LLM_MODEL', 'GOOGLE_GENERATIVE_AI_API_KEY', 'LLM_FALLBACK_MODEL']) {
      const index = find(name);
      expect(index, `${name} is documented`).toBeGreaterThan(0);
      expect(lines[index - 1]!.startsWith('#') && lines.slice(0, index).some((line) => /^#\s*[^=]*\b/.test(line)), `${name} has a comment line above it`).toBe(true);
      expect(lines.slice(Math.max(0, index - 3), index).some((line) => line.includes(name) && line.trimStart().startsWith('#')), `${name} has a purpose comment`).toBe(true);
    }
    expect(lines[find('GOOGLE_GENERATIVE_AI_API_KEY')]!.trimStart().startsWith('#')).toBe(true);
    expect(lines[find('LLM_FALLBACK_MODEL')]!.trimStart().startsWith('#')).toBe(true);
    expect(lines[find('GROQ_API_KEY')]!.trimStart().startsWith('#')).toBe(false);
    expect(lines[find('LLM_MODEL')]).toBe('LLM_MODEL=openai/gpt-oss-120b');
    expect(lines.some((line) => /NEXT_PUBLIC_(?:GROQ|LLM|GOOGLE)/.test(line))).toBe(false);
  });

  it('R1.1 lists the seven dependencies and no verifier package in package.json (Requirement 1)', () => {
    const pkg = JSON.parse(readFileSync(path.join(APP, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    const dependencies = pkg['dependencies'] ?? {};
    expect(dependencies['ai']).toMatch(/^\^?7\./);
    expect(dependencies['@ai-sdk/groq']).toMatch(/^\^?4\./);
    expect(dependencies['@ai-sdk/google']).toBeDefined();
    expect(dependencies['zod']).toBeDefined();
    expect(dependencies['server-only']).toBeDefined();
    expect(dependencies['typescript']).toMatch(/^\^?6\./);
    expect(dependencies['@lazarus/mcp-curse-scanner']).toBe('workspace:*');
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      expect(Object.keys(pkg[section] ?? {}), section).not.toContain('@lazarus/pbt-verifier');
    }
  });
});
