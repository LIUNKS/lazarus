import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { packageRoot, workspaceRoot } from '../support/paths.ts';

const FORBIDDEN_MODULES = ['child_process', 'worker_threads', 'vm', 'net', 'http', 'https', 'http2', 'dgram', 'dns', 'tls'];
const DATABASE_OR_LLM = /^(pg|postgres|mysql2?|sqlite3|mongodb|mongoose|redis|ioredis|@supabase\/.*|ai|@ai-sdk\/.*|groq-sdk|openai|@anthropic-ai\/.*)$/;
const dbDir = join(workspaceRoot, 'db');
const testDir = join(packageRoot, 'test');

interface Scan {
  problems: string[];
  /** Relative imports that point to other files under test/. */
  localImports: string[];
}

function scanText(file: string, text: string): Scan {
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.ES2023, true);
  const problems: string[] = [];
  const localImports: string[] = [];
  const report = (item: string): number => problems.push(`${relative(packageRoot, file)}: ${item}`);

  const checkSpecifier = (specifier: string): void => {
    if (specifier.startsWith('.')) {
      const target = resolve(dirname(file), specifier);
      if (target === dbDir || target.startsWith(dbDir + sep)) report(`imports "${specifier}", which is inside db/`);
      else if (target.startsWith(testDir + sep)) localImports.push(target);
      return;
    }
    const name = specifier.replace(/^node:/, '');
    if (FORBIDDEN_MODULES.includes(name.split('/')[0]!)) report(`imports forbidden module "${specifier}"`);
    if (DATABASE_OR_LLM.test(specifier)) report(`imports database or LLM module "${specifier}"`);
  };

  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      checkSpecifier(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node)) {
      const [first] = node.arguments;
      const isImportCall = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isImportCall || isRequire) && first && ts.isStringLiteralLike(first)) checkSpecifier(first.text);
      if (ts.isIdentifier(node.expression) && node.expression.text === 'fetch') report('calls fetch()');
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'process' && node.name.text === 'env') report('reads process.env');
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return { problems, localImports };
}

function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesIn(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : [],
  );
}

/** The agreement tests and every test/ file they import, followed through relative imports. */
function agreementFiles(): string[] {
  const queue = filesIn(join(testDir, 'agreement'));
  const seen = new Set<string>();
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...scanText(file, readFileSync(file, 'utf8')).localImports);
  }
  return [...seen].sort();
}

describe('agreement files scan', () => {
  const files = agreementFiles();

  it('R17.10 finds the agreement tests and the support files they use', () => {
    const names = files.map((file) => relative(testDir, file).replace(/\\/g, '/'));
    expect(names).toEqual(expect.arrayContaining(['agreement/seed-agreement.test.ts', 'support/seed-loader.ts']));
  });

  it('R17.10 R20.3 R20.4 the agreement files import nothing from db/, no process, database, LLM, or network module, and read no environment variable', () => {
    const problems = files.flatMap((file) => scanText(file, readFileSync(file, 'utf8')).problems);
    expect(problems).toEqual([]);
  });

  it('R17.10 the scan detects each forbidden construct and accepts clean code', () => {
    const file = join(testDir, 'agreement', 'x.ts');
    const forbidden = [
      "import data from '../../../../db/seed/generate-seed.ts';",
      "import { spawn } from 'node:child_process';",
      "import pg from 'pg';",
      "import { createClient } from '@supabase/supabase-js';",
      "import http from 'node:http';",
      "const url = process.env.DATABASE_URL;",
      "await fetch('http://example.com');",
      "const m = await import('../../../../db/harness/pbt-runner.ts');",
    ];
    for (const code of forbidden) expect(scanText(file, code).problems, code).not.toEqual([]);
    const clean = ["import { readFileSync } from 'node:fs';", "import { x } from '../support/seed-loader.ts';"].join('\n');
    expect(scanText(file, clean).problems).toEqual([]);
  });
});
