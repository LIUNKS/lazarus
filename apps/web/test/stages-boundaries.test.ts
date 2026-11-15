// Boundary checks of the resurrection UI (06-resurrection-ui, Requirements 9, 14, 16, and 18).
// The sources are read with the TypeScript parser, so a comment is never mistaken for code or for an authored string.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_TERMS, containsForbiddenTerm } from '../src/lib/stages/wording';

const SRC = path.resolve(import.meta.dirname, '../src');
const LIB_DIR = path.join(SRC, 'lib', 'stages');
const COMPONENTS_DIR = path.join(SRC, 'components', 'stages');

const isTest = (name: string) => /\.test\.tsx?$/.test(name);
const sourcesOf = (dir: string) =>
  readdirSync(dir)
    .filter((name) => /\.tsx?$/.test(name) && !isTest(name))
    .map((name) => path.join(dir, name));

const libSources = sourcesOf(LIB_DIR);
const componentSources = sourcesOf(COMPONENTS_DIR);
const allSources = [...libSources, ...componentSources];
const rel = (file: string) => path.relative(SRC, file).replaceAll('\\', '/');

const parse = (file: string) =>
  ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/** Every string the code authors: literals, the literal parts of templates, and the text of JSX elements. */
function authoredStrings(file: string): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) found.push(node.text);
    if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) found.push(node.text);
    if (ts.isJsxText(node) && node.text.trim() !== '') found.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
  return found;
}

function importSpecifiers(file: string): string[] {
  return parse(file)
    .statements.filter(ts.isImportDeclaration)
    .map((statement) => (ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : ''));
}

function findNodes(file: string, predicate: (node: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
  return found;
}

/** True when the code reads `process.env`. A comment that mentions it does not count. */
function readsProcessEnv(file: string): boolean {
  return (
    findNodes(
      file,
      (node) =>
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'process' &&
        node.name.text === 'env',
    ).length > 0
  );
}

const isLocalImport = (specifier: string) => specifier.startsWith('.') || specifier.startsWith('@/');

function resolveImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith('@/') ? path.join(SRC, specifier.slice(2)) : specifier.startsWith('.') ? path.resolve(path.dirname(from), specifier) : null;
  if (base === null) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every file that `entry` imports directly or indirectly, with the bare package names it imports. */
function importClosure(entry: string): { files: string[]; packages: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of importSpecifiers(file)) {
      const resolved = resolveImport(file, specifier);
      if (resolved !== null) queue.push(resolved);
      else if (!specifier.startsWith('.') && !specifier.startsWith('@/')) packages.add(specifier);
    }
  }
  return { files: [...files], packages: [...packages] };
}

const FORBIDDEN_PACKAGE = /^(ai|@ai-sdk\/.*|server-only|node:.*)$/;
const LLM_AND_SECRET_NAMES = ['GROQ_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'LLM_MODEL', 'LLM_FALLBACK_MODEL', 'SUPABASE_SERVICE_ROLE_KEY'];

describe('stage module layout', () => {
  it('R14.7 finds the modules to scan', () => {
    expect(libSources.length).toBeGreaterThan(8);
    expect(componentSources.length).toBeGreaterThan(8);
    expect(libSources.map(rel)).toContain('lib/stages/pipeline-client.ts');
    expect(componentSources.map(rel)).toContain('components/stages/stage-actions.tsx');
  });
});

describe('R14.5 R16.8 wording', () => {
  it.each(allSources.filter((file) => path.basename(file) !== 'wording.ts').map((file) => [rel(file), file]))(
    'R14.5 %s authors no Forbidden_Term',
    (_name, file) => {
      for (const text of authoredStrings(file)) expect(containsForbiddenTerm(text), `"${text}"`).toBe(false);
    },
  );

  it('R14.5 the wording module is the only file that names the terms, and it lists them all', () => {
    const wording = authoredStrings(path.join(LIB_DIR, 'wording.ts'));
    for (const term of FORBIDDEN_TERMS) expect(wording).toContain(term);
  });

  it('R18.12 R6.9 the texts of the Verify_Control are free of Forbidden_Terms', async () => {
    const copy = await import('../src/lib/stages/copy');
    for (const text of [copy.ROUTE_COPY.verify.label, copy.ROUTE_COPY.verify.note, copy.ROUTE_COPY.verify.pendingText]) {
      expect(containsForbiddenTerm(text)).toBe(false);
    }
  });
});

describe('R14.7 types', () => {
  it.each(allSources.map((file) => [rel(file), file]))('%s has no explicit any', (_name, file) => {
    expect(findNodes(file, (node) => node.kind === ts.SyntaxKind.AnyKeyword)).toHaveLength(0);
  });
});

describe('R14.1 R14.6 rendering and code', () => {
  it.each(allSources.map((file) => [rel(file), file]))('%s does not set HTML and never evaluates code', (_name, file) => {
    const source = readFileSync(file, 'utf8');
    expect(source).not.toContain('dangerouslySetInnerHTML');
    const evaluates = findNodes(
      file,
      (node) =>
        (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === 'eval' || node.expression.text === 'Function')) ||
        (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function'),
    );
    expect(evaluates).toHaveLength(0);
    for (const specifier of importSpecifiers(file)) {
      expect(/^(node:vm|vm|node:child_process|child_process|@lazarus\/.*)$/.test(specifier), `${rel(file)} imports ${specifier}`).toBe(false);
    }
  });

  it('R14.1 R14.6 adds no markdown or HTML rendering package to the stage modules', () => {
    // Only packages are checked: the modules of this spec have their own `spec-markdown` files.
    for (const file of allSources) {
      for (const specifier of importSpecifiers(file).filter((item) => !isLocalImport(item))) {
        expect(/markdown|marked|remark|rehype|mdx|sanitize|dompurify|highlight|prism|shiki/i.test(specifier), `${rel(file)} imports ${specifier}`).toBe(false);
      }
    }
  });
});

describe('R9.8 R14.2 isolation', () => {
  it('R14.2 names no LLM configuration variable and no secret in any stage module', () => {
    for (const file of allSources) {
      const source = readFileSync(file, 'utf8');
      for (const name of LLM_AND_SECRET_NAMES) expect(source, `${rel(file)} names ${name}`).not.toContain(name);
    }
  });

  it('R14.2 reads no process.env in any stage module', () => {
    for (const file of allSources) expect(readsProcessEnv(file), rel(file)).toBe(false);
  });

  it('R9.8 the pure modules import only each other, the date helpers, and the row types', () => {
    for (const file of libSources) {
      for (const specifier of importSpecifiers(file)) {
        expect(/^(\.\/[\w-]+|@\/lib\/ui\/format|@\/lib\/ui\/status|@\/lib\/data\/types)$/.test(specifier), `${rel(file)} imports ${specifier}`).toBe(true);
      }
    }
  });

  it.each([
    ['components/stages/stage-actions.tsx', path.join(COMPONENTS_DIR, 'stage-actions.tsx')],
    ['components/stages/approve-seance-form.tsx', path.join(COMPONENTS_DIR, 'approve-seance-form.tsx')],
  ])('R9.8 %s imports no ai package, no @ai-sdk package, and no server-only module', (_name, file) => {
    for (const specifier of importSpecifiers(file)) expect(FORBIDDEN_PACKAGE.test(specifier), specifier).toBe(false);
  });

  it('R9.8 everything that StageActions imports, directly or not, is free of those packages and of server-only modules', () => {
    const { files, packages } = importClosure(path.join(COMPONENTS_DIR, 'stage-actions.tsx'));
    expect(files.length).toBeGreaterThan(5);
    for (const name of packages) expect(FORBIDDEN_PACKAGE.test(name), name).toBe(false);
    for (const file of files) {
      expect(importSpecifiers(file), rel(file)).not.toContain('server-only');
      expect(readsProcessEnv(file), rel(file)).toBe(false);
    }
    expect(files.map(rel)).not.toContain('lib/supabase/server.ts');
  });

  it('R9.8 only the two interactive components are client modules', () => {
    const clientFiles = componentSources.filter((file) => /^\s*['"]use client['"]/m.test(readFileSync(file, 'utf8'))).map((file) => path.basename(file));
    expect(clientFiles.sort()).toEqual(['approve-seance-form.tsx', 'stage-actions.tsx']);
  });
});

describe('R13 accessibility, theme, and motion (static checks)', () => {
  it('R13.5 uses theme tokens and no raw hex color in any stage module', () => {
    for (const file of allSources) {
      for (const text of authoredStrings(file)) expect(text, `${rel(file)}: "${text}"`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it('R13.6 adds no GSAP code and no animation timeline: only the existing Reveal animates the stage content', () => {
    for (const file of allSources) {
      expect(importSpecifiers(file), rel(file)).not.toContain('gsap');
      expect(importSpecifiers(file), rel(file)).not.toContain('@gsap/react');
    }
    const reveal = readFileSync(path.join(COMPONENTS_DIR, 'stage-sections.tsx'), 'utf8');
    expect(reveal).toContain("from '@/animations/reveal-section'");
  });

  it('R13.6 gives the pending indicator only a CSS animation behind the motion-safe variant', () => {
    const source = readFileSync(path.join(COMPONENTS_DIR, 'stage-actions.tsx'), 'utf8');
    const animations = source.match(/\S*animate-\S*/g) ?? [];
    expect(animations.length).toBeGreaterThan(0);
    for (const name of animations) expect(name.startsWith('motion-safe:'), name).toBe(true);
  });

  it('R13.3 announces pending and success politely and failures as an alert, through the shared Notice', () => {
    const source = readFileSync(path.join(COMPONENTS_DIR, 'stage-actions.tsx'), 'utf8');
    expect(source).toContain("<Notice tone=\"curse\" title={state.presentation.title}>");
    const notice = readFileSync(path.join(SRC, 'components', 'notice.tsx'), 'utf8');
    expect(notice).toContain("role={tone === 'curse' ? 'alert' : 'status'}");
  });

  it('R13.3 never moves focus on a failure: focus() is called only after a success', () => {
    const source = readFileSync(path.join(COMPONENTS_DIR, 'stage-actions.tsx'), 'utf8');
    expect(source.match(/\.focus\(\)/g)).toHaveLength(1);
    const successBranch = source.slice(source.indexOf("outcome.kind === 'success'"));
    expect(successBranch.indexOf('.focus()')).toBeGreaterThan(-1);
    expect(source.slice(0, source.indexOf("outcome.kind === 'success'"))).not.toContain('.focus()');
  });

  it('R10.1 calls router.refresh exactly once, and only after a success', () => {
    const source = readFileSync(path.join(COMPONENTS_DIR, 'stage-actions.tsx'), 'utf8');
    expect(source.match(/router\.refresh\(\)/g)).toHaveLength(1);
    expect(source.slice(source.indexOf("outcome.kind === 'success'"))).toContain('router.refresh()');
  });

  it('R9.1 R9.2 sends the request through the pure client with the route and the corpse id from the props', () => {
    const source = readFileSync(path.join(COMPONENTS_DIR, 'stage-actions.tsx'), 'utf8');
    expect(source).toContain('runPipeline({ fetch: browserFetch }, route, corpseId, controller.signal)');
    expect(source).not.toMatch(/['"`]\/api\//);
  });
});

describe('R9.9 no streaming', () => {
  it('uses no streaming API in any stage module: a response is read as one JSON document', () => {
    for (const file of allSources) {
      const source = readFileSync(file, 'utf8');
      for (const marker of ['ReadableStream', 'getReader', 'text/event-stream', 'EventSource', 'TextDecoderStream']) {
        expect(source, `${rel(file)} uses ${marker}`).not.toContain(marker);
      }
    }
    const client = readFileSync(path.join(LIB_DIR, 'pipeline-client.ts'), 'utf8');
    expect(client.match(/\.json\(\)/g)).toHaveLength(1);
  });
});

describe('R15 loading and the page', () => {
  it('R15.1 renders the stages inside a Suspense boundary whose fallback is the skeleton, and loading.tsx reserves the same layout', () => {
    const page = readFileSync(path.join(SRC, 'app', 'corpses', '[id]', 'page.tsx'), 'utf8');
    expect(page).toContain('<Suspense fallback={<StagesSkeleton />}>');
    expect(page).toContain('<StageSections');
    const loading = readFileSync(path.join(SRC, 'app', 'corpses', '[id]', 'loading.tsx'), 'utf8');
    expect(loading).toContain('<StagesSkeleton />');
  });

  it('R1.2 the placeholder and the old curse list are gone, and nothing imports them', () => {
    expect(existsSync(path.join(SRC, 'components', 'next-stages.tsx'))).toBe(false);
    expect(existsSync(path.join(SRC, 'components', 'curse-list.tsx'))).toBe(false);
  });

  it('R15.5 R1.6 keeps the 404 for an invalid id and a corpse that is not visible, and the delete control for the owner', () => {
    const page = readFileSync(path.join(SRC, 'app', 'corpses', '[id]', 'page.tsx'), 'utf8');
    expect(page).toContain('if (!isUuid(id)) notFound();');
    expect(page).toContain('if (!corpse) notFound();');
    expect(page).toContain('<DeleteCorpseButton');
  });
});

describe('R6.8 R18.7 R18.12 the UI does not read the evidence field of a response', () => {
  it('reads no property named "evidence" in any stage module', () => {
    for (const file of allSources) {
      const reads = findNodes(
        file,
        (node) =>
          (ts.isPropertyAccessExpression(node) && node.name.text === 'evidence') ||
          (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === 'evidence'),
      );
      expect(reads, rel(file)).toHaveLength(0);
    }
  });
});
