import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { verifyTestCode } from '../src/index.ts';

interface Fixture {
  /** Folder name, which equals the `source_language` value of the corpses table. */
  name: 'es3' | 'es5-jquery' | 'legacy-node';
  entryFunction: string;
  /** A change to modern.ts that alters behavior for a large class of inputs. */
  mutation: { from: string; to: string };
}

const FIXTURES: Fixture[] = [
  {
    name: 'es3',
    entryFunction: 'sumPositive',
    mutation: { from: 'if (value > 0)', to: 'if (value > 100)' },
  },
  {
    name: 'es5-jquery',
    entryFunction: 'normalizeTags',
    mutation: { from: '.toLowerCase()', to: '' },
  },
  {
    name: 'legacy-node',
    entryFunction: 'buildQuery',
    mutation: { from: '    .sort()\n', to: '' },
  },
];

function read(fixture: Fixture, file: 'legacy.js' | 'modern.ts' | 'test-code.js'): string {
  return readFileSync(new URL(`./fixtures/${fixture.name}/${file}`, import.meta.url), 'utf8').replace(
    /\r\n/g,
    '\n',
  );
}

function parse(text: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true);
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

/** Reasons why a node is not ES5 syntax. The legacy sources of the sample format contain none. */
function es2015Violations(source: ts.SourceFile): string[] {
  const found: string[] = [];
  walk(source, (node) => {
    const add = (what: string): number => found.push(`${what} at offset ${node.getStart(source)}`);
    if (ts.isArrowFunction(node)) add('arrow function');
    if (ts.isClassLike(node)) add('class');
    if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) add('template literal');
    if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) add('spread');
    if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.BlockScoped) !== 0) add('let/const');
    if (ts.isForOfStatement(node)) add('for-of');
    if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) add('destructuring');
    if (ts.isParameter(node) && (node.initializer !== undefined || node.dotDotDotToken !== undefined)) {
      add('default or rest parameter');
    }
    if (ts.isShorthandPropertyAssignment(node)) add('shorthand property');
    if (ts.isComputedPropertyName(node)) add('computed property name');
    if (ts.isMethodDeclaration(node)) add('method shorthand');
    if (ts.isAwaitExpression(node) || ts.isYieldExpression(node)) add('async or generator');
    if (ts.isFunctionLike(node) && 'asteriskToken' in node && node.asteriskToken !== undefined) add('generator');
    if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
      add('async');
    }
    if (ts.isBinaryExpression(node)) {
      const kind = node.operatorToken.kind;
      if (kind === ts.SyntaxKind.AsteriskAsteriskToken || kind === ts.SyntaxKind.QuestionQuestionToken) add('operator');
    }
    if ((node.flags & ts.NodeFlags.OptionalChain) !== 0) add('optional chaining');
    if (ts.isBigIntLiteral(node)) add('bigint');
    if (ts.isRegularExpressionLiteral(node) && !/\/[gim]*$/.test(node.text)) add('regex flag beyond g, i, m');
  });
  return found;
}

const FORBIDDEN_GLOBALS = ['module', 'exports', 'require', '$', 'jQuery', 'window', 'document', 'global'];

describe('ES2015 detector', () => {
  it('R11.3 flags each modern construct, so a clean result on the fixtures means something', () => {
    const snippets = [
      'var f = (x) => x;',
      'class A {}',
      'var s = `t`;',
      'f(...a);',
      'let a = 1;',
      'const b = 1;',
      'for (var v of a) {}',
      'var { a } = o;',
      'function g(a = 1) {}',
      'var o = { a };',
      'var o = { [k]: 1 };',
      'var o = { m() {} };',
      'async function h() {}',
      'function* gen() {}',
      'var p = a ** 2;',
      'var q = a ?? 1;',
      'var r = a?.b;',
      'var n = 10n;',
      'var re = /a/u;',
    ];
    for (const snippet of snippets) {
      expect(es2015Violations(parse(snippet, 'snippet.js')), snippet).not.toEqual([]);
    }
    expect(es2015Violations(parse('var x = /a+/gi; function f(a) { return [a].map(function (v) { return v; }); }', 's.js'))).toEqual([]);
  });
});

describe('fixture layout', () => {
  it('R11.3 provides one fixture per source_language of the corpses table', () => {
    expect(FIXTURES.map((fixture) => fixture.name).sort()).toEqual(['es3', 'es5-jquery', 'legacy-node']);
  });
});

describe.each(FIXTURES)('fixture $name', (fixture) => {
  const legacy = read(fixture, 'legacy.js');
  const modern = read(fixture, 'modern.ts');
  const testCode = read(fixture, 'test-code.js');

  it('R11.3 legacy.js follows the sample source format and holds no ES2015 or later syntax', () => {
    const source = parse(legacy, 'legacy.js');
    expect(es2015Violations(source)).toEqual([]);

    const identifiers = new Set<string>();
    walk(source, (node) => {
      if (ts.isIdentifier(node)) identifiers.add(node.text);
    });
    for (const name of FORBIDDEN_GLOBALS) expect(identifiers.has(name), name).toBe(false);

    const declarations = source.statements.filter(ts.isFunctionDeclaration);
    expect(source.statements.length).toBe(declarations.length);
    expect(declarations).toHaveLength(1);
    expect(declarations[0].name?.text).toBe(fixture.entryFunction);
  });

  it('R11.3 modern.ts exports the entry function and has no any, var, eval, or imports', () => {
    const source = parse(modern, 'modern.ts');
    const problems: string[] = [];
    walk(source, (node) => {
      if (node.kind === ts.SyntaxKind.AnyKeyword) problems.push('any');
      if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.BlockScoped) === 0) problems.push('var');
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'eval') {
        problems.push('eval');
      }
      if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) problems.push('import');
    });
    expect(problems).toEqual([]);
    const exported = source.statements.filter(
      (statement): statement is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(statement) &&
        ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true,
    );
    expect(exported.map((declaration) => declaration.name?.text)).toEqual([fixture.entryFunction]);
  });

  it('R11.3 test-code.js follows the Test_Code_Contract', () => {
    expect(testCode).not.toMatch(/^\s*(import|export)\b/m);
    expect(testCode).not.toMatch(/\brequire\s*\(/);
    // The run count belongs to the Verifier: no literal count, and no own fc.assert or fc.check.
    expect(testCode).not.toMatch(/numRuns\s*:\s*\d/);
    expect(testCode).not.toMatch(/\bfc\.(assert|check)\s*\(/);
    expect(testCode).toMatch(/\bassertEquivalent\(/);

    const wrapper = parse(`function body() {\n${testCode}\n}`, 'test-code.js');
    const body = wrapper.statements.find(ts.isFunctionDeclaration)?.body;
    const last = body?.statements[body.statements.length - 1];
    expect(last !== undefined && ts.isReturnStatement(last)).toBe(true);
    const returned = last !== undefined && ts.isReturnStatement(last) ? last.expression : undefined;
    expect(returned !== undefined && ts.isCallExpression(returned)).toBe(true);
    expect(returned?.getText(wrapper).startsWith('fc.property(')).toBe(true);
  });

  it('R11.1 R11.3 R12.9 passes with exactly 1,000 generated inputs and maps to the reincarnations columns', async () => {
    const result = await verifyTestCode({
      origin: 'sample',
      legacyCode: legacy,
      modernCode: modern,
      entryFunction: fixture.entryFunction,
      testCode,
      numRuns: 1000,
      seed: 20260101,
    });
    if (result.status !== 'PASSED') throw new Error(`Expected PASSED, got ${JSON.stringify(result)}`);
    expect(result.totalRuns).toBe(1000);
    expect(result.seed).toBe(20260101);
    expect(result.evidence).toBe(
      'Verified behavioral equivalence across 1,000 generated inputs (seed 20260101).',
    );

    const row = {
      pbt_passed: result.status === 'PASSED',
      total_runs: result.totalRuns,
      execution_time_ms: result.executionTimeMs,
    };
    expect(row.pbt_passed).toBe(true);
    expect(Number.isInteger(row.total_runs)).toBe(true);
    expect(Number.isInteger(row.execution_time_ms)).toBe(true);
    expect(row.execution_time_ms).toBeGreaterThanOrEqual(1);
    expect(row.execution_time_ms).toBeLessThanOrEqual(600_000);
  });

  it('R12.3 the test code finds a difference when modern.ts is changed', async () => {
    const changed = modern.replace(fixture.mutation.from, fixture.mutation.to);
    expect(changed, 'the mutation must change modern.ts').not.toBe(modern);
    const result = await verifyTestCode({
      origin: 'sample',
      legacyCode: legacy,
      modernCode: changed,
      entryFunction: fixture.entryFunction,
      testCode,
      numRuns: 1000,
      seed: 20260101,
    });
    expect(result.status).toBe('FAILED');
    if (result.status === 'FAILED') {
      expect(result.counterexample.legacyOutcome).not.toBe(result.counterexample.modernOutcome);
      expect(result.evidence).toMatch(/^Found a behavioral difference after [\d,]+ generated inputs \(seed 20260101\)\.$/);
    }
  });
});
