// Boundary and route-shape checks of the Verification_API (08-live-verification-api, Requirements 1, 4, 9, and 10).
// The sources are read with the TypeScript parser, so a comment is never mistaken for code or for an authored string.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { containsForbiddenPhrase } from '../src/lib/pipeline/forbidden';
import { VERIFY_ERROR_CODES, VERIFY_ERROR_TABLE } from '../src/lib/verification/errors';
import { USER_EXECUTION_ENABLED } from '../src/lib/verification/flags';

const SRC = path.resolve(import.meta.dirname, '../src');
const VERIFICATION_DIR = path.join(SRC, 'lib', 'verification');
const ROUTE_FILE = path.join(SRC, 'app', 'api', 'verify', 'route.ts');

const isTest = (name: string) => /\.test\.ts$/.test(name);
const verificationSources = [
  ...readdirSync(VERIFICATION_DIR)
    .filter((name) => name.endsWith('.ts') && !isTest(name))
    .map((name) => path.join(VERIFICATION_DIR, name)),
  path.join(SRC, 'lib', 'env-server.ts'),
  ROUTE_FILE,
];
const rel = (file: string) => path.relative(SRC, file).replaceAll('\\', '/');
const parse = (file: string) => ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

/** Every string the code authors: string literals and the literal parts of template literals. */
function authoredStrings(file: string): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) found.push(node.text);
    if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) found.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
  return found;
}

// The list of Requirement 9 criterion 1, with its statuses.
const REQUIRED_CODES: Record<string, number> = {
  INVALID_REQUEST: 400,
  AUTH_REQUIRED: 401,
  FORBIDDEN_ORIGIN: 403,
  NOT_FOUND: 404,
  NOT_PRECOMPUTED: 404,
  METHOD_NOT_ALLOWED: 405,
  SEANCE_REQUIRED: 409,
  REINCARNATION_REQUIRED: 409,
  REQUEST_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  VERIFICATION_INCONCLUSIVE: 422,
  RATE_LIMITED: 429,
  VERIFICATION_BUSY: 429,
  INTERNAL_ERROR: 500,
  PERSISTENCE_FAILED: 500,
  QUOTA_UNAVAILABLE: 503,
  VERIFICATION_DISABLED: 503,
  SANDBOX_UNAVAILABLE: 503,
};

describe('verification boundaries', () => {
  it('R1.2 the route file exports exactly POST, runtime nodejs, dynamic force-dynamic, and maxDuration 60 (Requirement 1)', () => {
    expect(existsSync(ROUTE_FILE)).toBe(true);
    const exported = new Map<string, ts.Expression | undefined>();
    for (const statement of parse(ROUTE_FILE).statements) {
      const isExported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (ts.isExportAssignment(statement) || ts.isExportDeclaration(statement)) exported.set(`<${ts.SyntaxKind[statement.kind]}>`, undefined);
      if (!isExported) continue;
      if (ts.isFunctionDeclaration(statement) && statement.name) exported.set(statement.name.text, undefined);
      else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) exported.set(declaration.name.text, declaration.initializer);
        }
      } else exported.set(`<${ts.SyntaxKind[statement.kind]}>`, undefined);
    }
    expect([...exported.keys()].sort()).toEqual(['POST', 'dynamic', 'maxDuration', 'runtime']);
    const text = (name: string) => {
      const value = exported.get(name);
      return value !== undefined && (ts.isStringLiteral(value) || ts.isNumericLiteral(value)) ? value.text : null;
    };
    expect(text('runtime')).toBe('nodejs');
    expect(text('dynamic')).toBe('force-dynamic');
    expect(text('maxDuration')).toBe('60');
    expect(ts.isNumericLiteral(exported.get('maxDuration') as ts.Expression)).toBe(true);
  });

  it('R4.1 the committed Execution_Flag is false (Requirement 4)', () => {
    expect(USER_EXECUTION_ENABLED).toBe(false);
    const flags = parse(path.join(VERIFICATION_DIR, 'flags.ts'));
    const declarations = flags.statements.filter(ts.isVariableStatement).flatMap((statement) => statement.declarationList.declarations);
    expect(declarations.map((declaration) => declaration.name.getText())).toEqual(['USER_EXECUTION_ENABLED']);
    expect(declarations[0]?.initializer?.kind).toBe(ts.SyntaxKind.FalseKeyword);
  });

  it('R10.1 no authored string of the Verification_API contains a Forbidden_Phrase (Requirement 10)', () => {
    expect(verificationSources.length).toBeGreaterThanOrEqual(14);
    let checked = 0;
    for (const file of verificationSources) {
      for (const value of authoredStrings(file)) {
        checked += 1;
        expect(containsForbiddenPhrase(value), `${rel(file)}: ${value}`).toBe(false);
      }
    }
    expect(checked).toBeGreaterThan(100);
    // Sanity check of the search itself.
    expect(containsForbiddenPhrase('a guaranteed result')).toBe(true);
  });

  it('R9.1 the error code list in source equals Requirement 9 criterion 1, with the same statuses (Requirement 9)', () => {
    expect([...VERIFY_ERROR_CODES].sort()).toEqual(Object.keys(REQUIRED_CODES).sort());
    expect(VERIFY_ERROR_CODES).toHaveLength(18);
    for (const [code, status] of Object.entries(REQUIRED_CODES)) {
      expect(VERIFY_ERROR_TABLE[code as keyof typeof VERIFY_ERROR_TABLE].status, code).toBe(status);
    }
  });
});
