import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { CURSE_CORPUS } from '../support/curse-corpus.ts';
import { packageRoot } from '../support/paths.ts';

const testDir = join(packageRoot, 'test');
const TITLE_PREFIX = /^R\d+\.\d+/;
const TEST_FUNCTIONS = new Set(['it', 'test']);
const TEST_MODIFIERS = new Set(['skip', 'only', 'concurrent', 'todo', 'fails']);
const PROPERTY_COUNT = 17;

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

const files = testFiles(testDir);
const rel = (file: string): string => relative(packageRoot, file).replace(/\\/g, '/');

/** True for `it`, `test`, `it.skip`, and similar. */
function isTestCallee(node: ts.Expression): boolean {
  if (ts.isIdentifier(node)) return TEST_FUNCTIONS.has(node.text);
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    TEST_FUNCTIONS.has(node.expression.text) &&
    TEST_MODIFIERS.has(node.name.text)
  );
}

/** True for `it.each(table)` which is then called with the title. */
function isEachCallee(node: ts.Expression): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'each' &&
    ts.isIdentifier(node.expression.expression) &&
    TEST_FUNCTIONS.has(node.expression.expression.text)
  );
}

interface TitleProblem {
  file: string;
  title: string;
}

interface Scan {
  titles: number;
  problems: TitleProblem[];
  assertCalls: number;
}

function scanFile(file: string): Scan {
  const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2023, true);
  const scan: Scan = { titles: 0, problems: [], assertCalls: 0 };

  const check = (title: ts.Expression | undefined): void => {
    if (title === undefined) return;
    scan.titles++;
    let text: string;
    if (ts.isStringLiteralLike(title)) {
      text = title.text;
    } else if (ts.isTemplateExpression(title) && title.head.text === '') {
      // A title built as `${testCase.requirement} ...` takes the prefix from the corpus, which is checked separately.
      const first = title.templateSpans[0]?.expression;
      text = first !== undefined && first.getText() === 'testCase.requirement' ? 'R0.0 corpus requirement' : '';
    } else if (ts.isTemplateExpression(title)) {
      text = title.head.text;
    } else {
      text = '';
    }
    if (!TITLE_PREFIX.test(text)) scan.problems.push({ file: rel(file), title: title.getText() });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (isTestCallee(node.expression) || isEachCallee(node.expression)) check(node.arguments[0]);
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'assert' && ts.isIdentifier(callee.expression) && callee.expression.text === 'fc') {
        scan.assertCalls++;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return scan;
}

const FEATURE_COMMENT = /^[ \t]*\/\/ Feature: 02-scanner-and-verifier, (?:Property (\d+): .+|Supporting check: .+)$/gm;

describe('test conventions', () => {
  const scans = new Map(files.map((file) => [file, scanFile(file)]));

  it('R18.14 finds the test files', () => {
    expect(files.filter((file) => file.endsWith('.test.ts')).length).toBeGreaterThan(40);
  });

  it('R18.14 every test title starts with the requirement and criterion it verifies, in the form R<number>.<number>', () => {
    const problems = [...scans.values()].flatMap((scan) => scan.problems);
    expect(problems).toEqual([]);
  });

  it('R18.14 every Curse_Corpus case supplies a requirement in the form R<number>.<number>', () => {
    expect(CURSE_CORPUS.length).toBeGreaterThan(0);
    expect(CURSE_CORPUS.filter((testCase) => !TITLE_PREFIX.test(testCase.requirement)).map((testCase) => testCase.id)).toEqual([]);
  });

  it('R18.14 every file that calls fc.assert carries at least one Feature comment per call', () => {
    const missing: string[] = [];
    for (const [file, scan] of scans) {
      if (scan.assertCalls === 0) continue;
      const comments = [...readFileSync(file, 'utf8').matchAll(FEATURE_COMMENT)].length;
      if (comments < scan.assertCalls) missing.push(`${rel(file)}: ${scan.assertCalls} fc.assert calls, ${comments} Feature comments`);
    }
    expect(missing).toEqual([]);
  });

  it('R18.14 each design property number from 1 to 17 appears in exactly one Feature comment', () => {
    const counts = new Map<number, string[]>();
    for (const file of files) {
      for (const match of readFileSync(file, 'utf8').matchAll(FEATURE_COMMENT)) {
        if (match[1] === undefined) continue;
        const number = Number(match[1]);
        counts.set(number, [...(counts.get(number) ?? []), rel(file)]);
      }
    }
    const numbers = Array.from({ length: PROPERTY_COUNT }, (_, index) => index + 1);
    expect(Object.fromEntries(numbers.map((n) => [n, (counts.get(n) ?? []).length]))).toEqual(
      Object.fromEntries(numbers.map((n) => [n, 1])),
    );
    expect([...counts.keys()].filter((n) => n < 1 || n > PROPERTY_COUNT)).toEqual([]);
  });
});
