import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { packageRoot } from '../support/paths.ts';

const FORBIDDEN_MODULES = ['vm', 'child_process', 'worker_threads', 'fs', 'net', 'http', 'https', 'dgram', 'dns'];
const FORBIDDEN_PACKAGES = /^(pg|postgres|mysql2?|sqlite3|mongodb|mongoose|redis|ioredis|@supabase\/.*|ai|@ai-sdk\/.*|groq-sdk|openai|@anthropic-ai\/.*)$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

const moduleName = (specifier: string): string => specifier.replace(/^node:/, '');

function problemsInText(file: string, text: string): string[] {
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.ES2023, true);
  const problems: string[] = [];
  const report = (item: string): number => problems.push(`${relative(packageRoot, file)}: ${item}`);

  const checkSpecifier = (specifier: string): void => {
    const name = moduleName(specifier);
    if (FORBIDDEN_MODULES.includes(name.split('/')[0]!)) report(`imports forbidden module "${specifier}"`);
    if (FORBIDDEN_PACKAGES.test(specifier)) report(`imports database or LLM module "${specifier}"`);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) checkSpecifier(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const [first] = node.arguments;
      const isImportCall = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      if ((isImportCall || isRequire) && first && ts.isStringLiteralLike(first)) checkSpecifier(first.text);
      if (ts.isIdentifier(callee) && ['eval', 'Function', 'fetch'].includes(callee.text)) report(`calls ${callee.text}()`);
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function') {
      report('uses new Function');
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === 'console') report(`uses console.${node.name.text}`);
      if (ts.isIdentifier(node.expression) && node.expression.text === 'process' && node.name.text === 'env') report('reads process.env');
    }
    if (ts.isStringLiteralLike(node) && /\.kiro[\\/]settings/.test(node.text)) report('mentions .kiro/settings');
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return problems;
}

const problemsIn = (file: string): string[] => problemsInText(file, readFileSync(file, 'utf8'));

describe('scanner source scan', () => {
  const files = sourceFiles(join(packageRoot, 'src'));

  it('R18.11 finds the source files', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('R3.10 R15.1 R15.2 R15.8 R16.3 R20.3 R20.4 R20.5 src/ never executes code, touches the network or disk, logs to stdout, reads the environment, or imports a database or LLM module', () => {
    expect(files.flatMap(problemsIn)).toEqual([]);
  });

  it('R18.11 the scan itself detects each forbidden construct and accepts clean code', () => {
    const forbidden = [
      "import fs from 'node:fs';",
      "import { spawn } from 'child_process';",
      "import vm from 'node:vm';",
      "const m = await import('worker_threads');",
      "const m = require('node:net');",
      'eval(x);',
      "new Function('return 1');",
      "Function('return 1')();",
      "console.log('x');",
      'const e = process.env.HOME;',
      "fetch('http://example.com');",
      "import { createClient } from '@supabase/supabase-js';",
      "import pg from 'pg';",
      "import { generateText } from 'ai';",
      "const path = '.kiro/settings/mcp.json';",
    ];
    for (const code of forbidden) {
      expect(problemsInText('src/x.ts', code), code).not.toEqual([]);
    }
    const clean = ["import { createRequire } from 'node:module';", "process.stderr.write('x');"].join('\n');
    expect(problemsInText('src/x.ts', clean)).toEqual([]);
  });
});
