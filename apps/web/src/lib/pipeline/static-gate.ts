// The Static_Gate for generated code (Requirement 13). Nothing here runs the code: the gate parses and
// type-checks `modernCode` in memory with the TypeScript compiler API and walks the syntax trees.
// Pure module (depends on `typescript` only). It reads no file other than the ES library declaration files
// shipped in the `typescript` package, writes no file, and returns the same verdict for the same input
// (except when the type-check timeout applies).
import ts from 'typescript';
import { containsForbiddenPhrase } from './forbidden';
import { LIMITS } from './limits';

export type GateRule =
  | 'MODERN_TYPECHECK'
  | 'MODERN_NO_IMPORTS'
  | 'MODERN_ENTRY_EXPORT'
  | 'MODERN_FORBIDDEN_CONSTRUCTS'
  | 'TEST_SYNTAX'
  | 'TEST_CONTRACT'
  | 'TEST_ASSERT_EQUIVALENT'
  | 'FORBIDDEN_PHRASE';

/** Failed rules are always reported in this order. */
const RULE_ORDER: readonly GateRule[] = [
  'MODERN_TYPECHECK',
  'MODERN_NO_IMPORTS',
  'MODERN_ENTRY_EXPORT',
  'MODERN_FORBIDDEN_CONSTRUCTS',
  'TEST_SYNTAX',
  'TEST_CONTRACT',
  'TEST_ASSERT_EQUIVALENT',
  'FORBIDDEN_PHRASE',
];

export interface Diagnostic {
  line: number;
  column: number;
  code: number;
  message: string;
}

export type GateVerdict = { ok: true } | { ok: false; failedRules: GateRule[]; diagnostics: Diagnostic[] };

export interface GateOptions {
  now?: () => number;
  typecheckTimeoutMs?: number;
  maxDiagnostics?: number;
}

const MODERN_MIN_LENGTH = 1;
const MODERN_MAX_LENGTH = 30_000;
const TEST_MIN_LENGTH = 1;
const TEST_MAX_LENGTH = 10_000;
const MAX_DIAGNOSTIC_MESSAGE = 300;

// ---------------------------------------------------------------------------------------------
// Compiler host: in-memory module, allowlisted library files, no writes.
// ---------------------------------------------------------------------------------------------

const VIRTUAL_DIR = '/virtual';
const MODULE_FILE = `${VIRTUAL_DIR}/module.ts`;
const LIB_FILE = /^lib\.(?:es[\w.]*|decorators[\w.]*)\.d\.ts$/;

const COMPILER_OPTIONS: ts.CompilerOptions = {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2022.d.ts'],
  types: [],
  noEmit: true,
  // A `/// <reference path>` or `/// <reference types>` directive and every import stay unresolved.
  noResolve: true,
  skipLibCheck: true,
};

let cachedLibDirectory: string | null = null;
function libDirectory(): string {
  if (cachedLibDirectory === null) {
    const defaultLib = ts.getDefaultLibFilePath(COMPILER_OPTIONS).replaceAll('\\', '/');
    cachedLibDirectory = defaultLib.slice(0, defaultLib.lastIndexOf('/'));
  }
  return cachedLibDirectory;
}

/** Only `lib.es*.d.ts` and `lib.decorators*.d.ts` of the compiler package are readable. `lib.dom.d.ts` is not. */
function isAllowedLibFile(fileName: string): boolean {
  const normalized = fileName.replaceAll('\\', '/');
  const slash = normalized.lastIndexOf('/');
  return slash > 0 && normalized.slice(0, slash) === libDirectory() && LIB_FILE.test(normalized.slice(slash + 1));
}

// Parsing the library files dominates the cost of a check, and a parsed SourceFile is not changed by a program.
const libSourceFiles = new Map<string, ts.SourceFile>();

function createHost(code: string): ts.CompilerHost {
  return {
    getSourceFile(fileName, languageVersionOrOptions) {
      if (fileName === MODULE_FILE) return ts.createSourceFile(fileName, code, languageVersionOrOptions, true);
      if (!isAllowedLibFile(fileName)) return undefined;
      const cached = libSourceFiles.get(fileName);
      if (cached) return cached;
      const text = ts.sys.readFile(fileName);
      if (text === undefined) return undefined;
      const file = ts.createSourceFile(fileName, text, languageVersionOrOptions, false);
      libSourceFiles.set(fileName, file);
      return file;
    },
    getDefaultLibFileName: () => `${libDirectory()}/lib.es2022.d.ts`,
    getDefaultLibLocation: () => libDirectory(),
    writeFile: () => {
      throw new Error('The static gate must not write files.');
    },
    getCurrentDirectory: () => VIRTUAL_DIR,
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (fileName) => fileName === MODULE_FILE || (isAllowedLibFile(fileName) && ts.sys.fileExists(fileName)),
    readFile: (fileName) =>
      fileName === MODULE_FILE ? code : isAllowedLibFile(fileName) ? ts.sys.readFile(fileName) : undefined,
    directoryExists: () => false,
    getDirectories: () => [],
  };
}

function toDiagnostic(diagnostic: ts.Diagnostic): Diagnostic {
  let line = 0;
  let column = 0;
  if (diagnostic.file !== undefined && diagnostic.start !== undefined) {
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    line = position.line + 1;
    column = position.character + 1;
  }
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  return { line, column, code: diagnostic.code, message: message.slice(0, MAX_DIAGNOSTIC_MESSAGE) };
}

// ---------------------------------------------------------------------------------------------
// Syntax-tree helpers
// ---------------------------------------------------------------------------------------------

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false);
}

/** True for a declaration inside a `declare` statement (for example `declare const process: unknown`). */
function isAmbient(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node; current !== undefined; current = current.parent) {
    if (hasModifier(current, ts.SyntaxKind.DeclareKeyword)) return true;
  }
  return false;
}

function skipParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}

/** True when the identifier is a reference to a binding, and false when it only names a property, label, or member. */
function isReferencePosition(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) return false;
  if (ts.isQualifiedName(parent) && parent.right === identifier) return false;
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isEnumMember(parent)) &&
    parent.name === identifier
  ) {
    return false;
  }
  if (ts.isBindingElement(parent) && parent.propertyName === identifier) return false;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return parent.propertyName === undefined || parent.propertyName === identifier;
  return true;
}

function stringKey(expression: ts.Expression): string | null {
  return ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression) ? expression.text : null;
}

// ---------------------------------------------------------------------------------------------
// modernCode
// ---------------------------------------------------------------------------------------------

const BANNED_GLOBALS: ReadonlySet<string> = new Set([
  'Date',
  'setTimeout',
  'setInterval',
  'process',
  'require',
  'window',
  'document',
  'globalThis',
  'fetch',
  'eval',
]);

interface ModernAnalysis {
  noImportsFailed: boolean;
  entryExportFailed: boolean;
  forbiddenConstructsFailed: boolean;
}

function isImportLike(node: ts.Node): boolean {
  if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isImportTypeNode(node)) return true;
  if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) return true;
  if (ts.isCallExpression(node)) {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
    if (ts.isIdentifier(node.expression) && node.expression.text === 'require') return true;
  }
  return false;
}

function isFunctionValue(expression: ts.Expression | undefined): boolean {
  if (expression === undefined) return false;
  const inner = skipParentheses(expression);
  return ts.isArrowFunction(inner) || ts.isFunctionExpression(inner);
}

/** The entry function is exported under its exact name, as a function declaration or a function-valued const. */
function exportsEntryFunction(sourceFile: ts.SourceFile, entryFunction: string | null): boolean {
  if (entryFunction === null || entryFunction === '') return false;

  const localFunctions = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) localFunctions.add(statement.name.text);
    if (ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && isFunctionValue(declaration.initializer)) localFunctions.add(declaration.name.text);
      }
    }
  }

  for (const statement of sourceFile.statements) {
    const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword) && !hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
    if (exported && ts.isFunctionDeclaration(statement) && statement.name?.text === entryFunction) return true;
    if (exported && ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === entryFunction && isFunctionValue(declaration.initializer)) return true;
      }
    }
    // `export { entryFunction }` for a function that is declared at the top level.
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      !statement.isTypeOnly &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const specifier of statement.exportClause.elements) {
        const local = (specifier.propertyName ?? specifier.name).text;
        if (!specifier.isTypeOnly && specifier.name.text === entryFunction && localFunctions.has(local)) return true;
      }
    }
  }
  return false;
}

/** Identifiers that an assignment, `++`, `--`, or destructuring assignment writes to. */
function collectAssignmentTargets(expression: ts.Node, out: ts.Identifier[]): void {
  if (ts.isIdentifier(expression)) {
    out.push(expression);
  } else if (ts.isParenthesizedExpression(expression)) {
    collectAssignmentTargets(expression.expression, out);
  } else if (ts.isArrayLiteralExpression(expression)) {
    for (const element of expression.elements) {
      if (ts.isSpreadElement(element)) collectAssignmentTargets(element.expression, out);
      else if (ts.isBinaryExpression(element) && element.operatorToken.kind === ts.SyntaxKind.EqualsToken) collectAssignmentTargets(element.left, out);
      else collectAssignmentTargets(element, out);
    }
  } else if (ts.isObjectLiteralExpression(expression)) {
    for (const property of expression.properties) {
      if (ts.isShorthandPropertyAssignment(property)) out.push(property.name);
      else if (ts.isPropertyAssignment(property)) {
        const value = property.initializer;
        if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.EqualsToken) collectAssignmentTargets(value.left, out);
        else collectAssignmentTargets(value, out);
      } else if (ts.isSpreadAssignment(property)) collectAssignmentTargets(property.expression, out);
    }
  }
}

function bindingIdentifiers(name: ts.BindingName, out: ts.Identifier[]): void {
  if (ts.isIdentifier(name)) {
    out.push(name);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) bindingIdentifiers(element.name, out);
  }
}

function analyzeModern(program: ts.Program, sourceFile: ts.SourceFile, entryFunction: string | null): ModernAnalysis {
  const checker = program.getTypeChecker();

  /** Unresolved, declared only in a library file, or declared with `declare`: the name is a global. */
  const isGlobalSymbol = (symbol: ts.Symbol | undefined): boolean => {
    if (symbol === undefined) return true;
    const declarations = symbol.declarations ?? [];
    if (declarations.length === 0) return true;
    return declarations.some((declaration) => declaration.getSourceFile() !== sourceFile || isAmbient(declaration));
  };
  const symbolOf = (identifier: ts.Identifier): ts.Symbol | undefined =>
    ts.isShorthandPropertyAssignment(identifier.parent) && identifier.parent.name === identifier
      ? checker.getShorthandAssignmentValueSymbol(identifier.parent)
      : checker.getSymbolAtLocation(identifier);
  const isGlobalReference = (identifier: ts.Identifier, name: string): boolean =>
    identifier.text === name && isReferencePosition(identifier) && isGlobalSymbol(symbolOf(identifier));

  // Module-level `let` bindings: reassigning one is module-level mutable state.
  const moduleLets = new Set<ts.Symbol>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const flags = statement.declarationList.flags;
    if ((flags & ts.NodeFlags.Let) === 0 || (flags & ts.NodeFlags.Const) !== 0) continue;
    for (const declaration of statement.declarationList.declarations) {
      const names: ts.Identifier[] = [];
      bindingIdentifiers(declaration.name, names);
      for (const name of names) {
        const symbol = checker.getSymbolAtLocation(name);
        if (symbol !== undefined) moduleLets.add(symbol);
      }
    }
  }

  let noImportsFailed = false;
  let forbiddenConstructsFailed = false;
  const writeTargets: ts.Identifier[] = [];

  walk(sourceFile, (node) => {
    if (isImportLike(node)) noImportsFailed = true;

    // `var` and `any`.
    if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.BlockScoped) === 0) forbiddenConstructsFailed = true;
    if (node.kind === ts.SyntaxKind.AnyKeyword) forbiddenConstructsFailed = true;

    // Global references: Date, timers, process, require, window, document, globalThis, fetch, eval.
    if (ts.isIdentifier(node) && BANNED_GLOBALS.has(node.text) && isGlobalReference(node, node.text)) forbiddenConstructsFailed = true;

    // Construction or call of the global `Function` constructor, which builds code from text.
    if ((ts.isNewExpression(node) || ts.isCallExpression(node)) && ts.isIdentifier(node.expression) && isGlobalReference(node.expression, 'Function')) {
      forbiddenConstructsFailed = true;
    }

    // `Math.random` and `Math['random']`.
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'random' && ts.isIdentifier(node.expression) && isGlobalReference(node.expression, 'Math')) {
      forbiddenConstructsFailed = true;
    }
    if (ts.isElementAccessExpression(node) && stringKey(node.argumentExpression) === 'random' && ts.isIdentifier(node.expression) && isGlobalReference(node.expression, 'Math')) {
      forbiddenConstructsFailed = true;
    }

    // Writes, for the module-level `let` rule.
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      collectAssignmentTargets(node.left, writeTargets);
    } else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      collectAssignmentTargets(node.operand, writeTargets);
    } else if ((ts.isForInStatement(node) || ts.isForOfStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) {
      collectAssignmentTargets(node.initializer, writeTargets);
    }
  });

  if (!forbiddenConstructsFailed && moduleLets.size > 0) {
    forbiddenConstructsFailed = writeTargets.some((target) => {
      const symbol = symbolOf(target);
      return symbol !== undefined && moduleLets.has(symbol);
    });
  }

  return {
    noImportsFailed,
    entryExportFailed: !exportsEntryFunction(sourceFile, entryFunction),
    forbiddenConstructsFailed,
  };
}

interface TypecheckResult {
  program: ts.Program;
  sourceFile: ts.SourceFile | undefined;
  errors: ts.Diagnostic[];
  cancelled: boolean;
}

function typecheck(code: string, now: () => number, timeoutMs: number): TypecheckResult {
  const program = ts.createProgram([MODULE_FILE], COMPILER_OPTIONS, createHost(code));
  const sourceFile = program.getSourceFile(MODULE_FILE);
  const start = now();
  const token: ts.CancellationToken = {
    isCancellationRequested: () => now() - start > timeoutMs,
    throwIfCancellationRequested() {
      if (this.isCancellationRequested()) throw new ts.OperationCanceledException();
    },
  };
  try {
    const diagnostics = [
      ...program.getOptionsDiagnostics(token),
      ...(sourceFile ? program.getSyntacticDiagnostics(sourceFile, token) : []),
      ...program.getGlobalDiagnostics(token),
      ...(sourceFile ? program.getSemanticDiagnostics(sourceFile, token) : []),
    ];
    return { program, sourceFile, errors: diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error), cancelled: false };
  } catch (error) {
    if (error instanceof ts.OperationCanceledException) return { program, sourceFile, errors: [], cancelled: true };
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// pbtTestCode
// ---------------------------------------------------------------------------------------------

const TEST_FILE = 'pbt-body.js';
const WRAPPER_HEAD = 'function __body(fc, legacyFn, modernFn, assertEquivalent, numRuns) ';

interface TestAnalysis {
  syntaxFailed: boolean;
  contractFailed: boolean;
  assertEquivalentMissing: boolean;
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return stringKey(name.expression);
  return null;
}

function isFcMember(expression: ts.Expression, names: readonly string[]): boolean {
  if (ts.isPropertyAccessExpression(expression)) {
    return ts.isIdentifier(expression.expression) && expression.expression.text === 'fc' && names.includes(expression.name.text);
  }
  if (ts.isElementAccessExpression(expression)) {
    const key = stringKey(expression.argumentExpression);
    return ts.isIdentifier(expression.expression) && expression.expression.text === 'fc' && key !== null && names.includes(key);
  }
  return false;
}

function analyzeTestCode(code: string): TestAnalysis {
  const lengthOk = code.length >= TEST_MIN_LENGTH && code.length <= TEST_MAX_LENGTH;
  const wrapper = `${WRAPPER_HEAD}{\n${code}\n}`;

  // Syntax errors: the body runs as JavaScript, so TypeScript-only syntax counts as an error too.
  const transpiled = ts.transpileModule(wrapper, {
    fileName: TEST_FILE,
    reportDiagnostics: true,
    compilerOptions: { allowJs: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  const hasSyntaxErrors = (transpiled.diagnostics ?? []).some((d) => d.category === ts.DiagnosticCategory.Error);

  const sourceFile = ts.createSourceFile(TEST_FILE, wrapper, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const first = sourceFile.statements[0];
  const wrapperFunction = first !== undefined && ts.isFunctionDeclaration(first) && first.name?.text === '__body' && first.body !== undefined ? first : null;
  // The body must not close the wrapper early: one top-level statement that ends at the last character.
  const insideWrapper =
    wrapperFunction !== null &&
    wrapperFunction.body !== undefined &&
    sourceFile.statements.length === 1 &&
    wrapperFunction.getEnd() === wrapper.length &&
    wrapperFunction.body.getEnd() === wrapper.length;

  const statements = wrapperFunction?.body?.statements ?? [];
  let usesModules = false;
  // `import` and `export` statements are syntax errors inside a function body, even where the TypeScript
  // parser only reports them later as grammar errors of the checker.
  let hasModuleSyntax = false;
  let callsAssertOrCheck = false;
  let setsNumRuns = false;
  let referencesAssertEquivalent = false;
  for (const statement of statements) {
    walk(statement, (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isExportAssignment(node) || ts.isImportEqualsDeclaration(node)) {
        usesModules = true;
        hasModuleSyntax = true;
      }
      if (hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
        usesModules = true;
        hasModuleSyntax = true;
      }
      if (isImportLike(node)) usesModules = true;
      if (ts.isCallExpression(node) && isFcMember(node.expression, ['assert', 'check'])) callsAssertOrCheck = true;
      if (
        (ts.isPropertyAssignment(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) &&
        propertyNameText(node.name) === 'numRuns'
      ) {
        setsNumRuns = true;
      }
      if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'numRuns') setsNumRuns = true;
      if (ts.isIdentifier(node) && node.text === 'assertEquivalent' && isReferencePosition(node)) referencesAssertEquivalent = true;
    });
  }

  const last = statements[statements.length - 1];
  const returned = last !== undefined && ts.isReturnStatement(last) && last.expression !== undefined ? skipParentheses(last.expression) : undefined;
  const endsWithProperty = returned !== undefined && ts.isCallExpression(returned) && isFcMember(returned.expression, ['property', 'asyncProperty']);

  return {
    syntaxFailed: !lengthOk || hasSyntaxErrors || !insideWrapper || hasModuleSyntax,
    contractFailed: usesModules || !endsWithProperty || callsAssertOrCheck || setsNumRuns,
    assertEquivalentMissing: !referencesAssertEquivalent,
  };
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

export function runStaticGate(
  output: { modernCode: string; pbtTestCode: string },
  entryFunction: string | null,
  options: GateOptions = {},
): GateVerdict {
  const now = options.now ?? Date.now;
  const timeoutMs = options.typecheckTimeoutMs ?? LIMITS.typecheckTimeoutMs;
  const maxDiagnostics = options.maxDiagnostics ?? LIMITS.maxDiagnostics;
  const failed = new Set<GateRule>();
  const diagnostics: Diagnostic[] = [];

  // modernCode: type-check and syntax-tree rules. An unexpected internal error counts as a rejection.
  const lengthOk = output.modernCode.length >= MODERN_MIN_LENGTH && output.modernCode.length <= MODERN_MAX_LENGTH;
  if (!lengthOk) failed.add('MODERN_TYPECHECK');
  try {
    const result = typecheck(output.modernCode, now, timeoutMs);
    if (result.cancelled || result.errors.length > 0) failed.add('MODERN_TYPECHECK');
    for (const error of result.errors.slice(0, maxDiagnostics)) diagnostics.push(toDiagnostic(error));
    if (result.sourceFile === undefined) {
      failed.add('MODERN_TYPECHECK');
    } else {
      const analysis = analyzeModern(result.program, result.sourceFile, entryFunction);
      if (analysis.noImportsFailed) failed.add('MODERN_NO_IMPORTS');
      if (analysis.entryExportFailed) failed.add('MODERN_ENTRY_EXPORT');
      if (analysis.forbiddenConstructsFailed) failed.add('MODERN_FORBIDDEN_CONSTRUCTS');
    }
  } catch {
    for (const rule of ['MODERN_TYPECHECK', 'MODERN_NO_IMPORTS', 'MODERN_ENTRY_EXPORT', 'MODERN_FORBIDDEN_CONSTRUCTS'] as const) failed.add(rule);
  }

  // pbtTestCode.
  try {
    const analysis = analyzeTestCode(output.pbtTestCode);
    if (analysis.syntaxFailed) failed.add('TEST_SYNTAX');
    if (analysis.contractFailed) failed.add('TEST_CONTRACT');
    if (analysis.assertEquivalentMissing) failed.add('TEST_ASSERT_EQUIVALENT');
  } catch {
    for (const rule of ['TEST_SYNTAX', 'TEST_CONTRACT', 'TEST_ASSERT_EQUIVALENT'] as const) failed.add(rule);
  }

  // Forbidden phrases, in raw text: comments and string literals count here.
  if (containsForbiddenPhrase([output.modernCode, output.pbtTestCode])) failed.add('FORBIDDEN_PHRASE');

  if (failed.size === 0) return { ok: true };
  return { ok: false, failedRules: RULE_ORDER.filter((rule) => failed.has(rule)), diagnostics };
}
