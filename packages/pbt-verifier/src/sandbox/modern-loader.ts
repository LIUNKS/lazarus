import ts from 'typescript';
import { createEntryReader, createSandbox, describeThrown } from './context.js';
import { loadFailure, missingEntryMessage, type LoadResult } from './load-result.js';

const MODULE_FILE = 'module.ts';
const MAX_DIAGNOSTICS = 10;

/** Requirement 5, criterion 1: strict, ES2022, ES2022 default library only, no DOM, no Node.js types. */
const CHECK_OPTIONS: ts.CompilerOptions = {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  lib: ['lib.es2022.d.ts'],
  types: [],
  noEmit: true,
  skipLibCheck: true,
};

const TRANSPILE_OPTIONS: ts.CompilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
};

/** Directory of the library declaration files shipped in the `typescript` package ('/' separators). */
const LIB_DIRECTORY = ts.getDefaultLibFilePath(CHECK_OPTIONS).replace(/\/[^/]*$/, '');

/**
 * Parsed library files, shared by every verification in the process. It holds only `lib.*.d.ts` files
 * read from the `typescript` package, never user code, so it carries no state between verifications.
 */
const libraryCache = new Map<string, ts.SourceFile>();

function isLibraryFile(fileName: string): boolean {
  return (
    fileName.startsWith(`${LIB_DIRECTORY}/`) && fileName.endsWith('.d.ts') && !fileName.includes('..')
  );
}

function readLibrary(
  fileName: string,
  languageVersion: ts.ScriptTarget | ts.CreateSourceFileOptions,
): ts.SourceFile | undefined {
  const cached = libraryCache.get(fileName);
  if (cached !== undefined) return cached;
  const text = ts.sys.readFile(fileName);
  if (text === undefined) return undefined;
  const parsed = ts.createSourceFile(fileName, text, languageVersion, false);
  libraryCache.set(fileName, parsed);
  return parsed;
}

/** An in-memory host: it serves the module and the library files and refuses to write anything. */
function createHost(source: ts.SourceFile, code: string): ts.CompilerHost {
  return {
    getSourceFile: (fileName, languageVersion) =>
      fileName === MODULE_FILE
        ? source
        : isLibraryFile(fileName)
          ? readLibrary(fileName, languageVersion)
          : undefined,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    getDefaultLibLocation: () => LIB_DIRECTORY,
    writeFile: () => {
      throw new Error('The type check must not write files.');
    },
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (fileName) =>
      fileName === MODULE_FILE || (isLibraryFile(fileName) && ts.sys.fileExists(fileName)),
    readFile: (fileName) => (fileName === MODULE_FILE ? code : undefined),
  };
}

function isModuleReference(node: ts.Node): boolean {
  return (
    ts.isImportDeclaration(node) ||
    (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) ||
    (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) ||
    ts.isImportTypeNode(node) ||
    (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
  );
}

/** Finds the first import of another module: static, `import x = require`, re-export, or dynamic. */
function findImport(source: ts.SourceFile): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (isModuleReference(node)) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function renderDiagnostic(diagnostic: ts.Diagnostic): string {
  const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ').replace(/\s+/g, ' ');
  if (diagnostic.file !== undefined && diagnostic.start !== undefined) {
    const { line, character } = ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start);
    return `${line + 1}:${character + 1} TS${diagnostic.code} ${text}`;
  }
  return `0:0 TS${diagnostic.code} ${text}`;
}

/** Error diagnostics of the module: syntactic, semantic, global, then options. */
function typeCheck(source: ts.SourceFile, code: string): string[] {
  const program = ts.createProgram([MODULE_FILE], CHECK_OPTIONS, createHost(source, code));
  return [
    ...program.getSyntacticDiagnostics(source),
    ...program.getSemanticDiagnostics(source),
    ...program.getGlobalDiagnostics(),
    ...program.getOptionsDiagnostics(),
  ]
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map(renderDiagnostic);
}

/** Result of the compile step: the transpiled CommonJS text, or the compile error. */
export type CompileResult =
  | { ok: true; js: string }
  | { ok: false; code: 'MODERN_COMPILE_ERROR'; message: string };

/**
 * The compile step of Requirement 5 on its own: rejects imports, type-checks under `strict`, and
 * transpiles to CommonJS. It runs only the TypeScript compiler on text and executes nothing.
 *
 * `entryFunction` is part of the signature for callers that compile and load in separate steps. The
 * compile step does not need it: a missing export is reported when the module is loaded.
 */
export function compileModernCode(code: string, entryFunction: string): CompileResult {
  void entryFunction;
  const source = ts.createSourceFile(MODULE_FILE, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

  const importNode = findImport(source);
  if (importNode !== undefined) {
    const { line, character } = ts.getLineAndCharacterOfPosition(source, importNode.getStart(source));
    return {
      ok: false,
      code: 'MODERN_COMPILE_ERROR',
      message: `Imports are not supported in the modern code (found at ${line + 1}:${character + 1}). Make the module self-contained.`,
    };
  }

  const diagnostics = typeCheck(source, code);
  if (diagnostics.length > 0) {
    const shown = diagnostics.slice(0, MAX_DIAGNOSTICS);
    const header =
      diagnostics.length > shown.length
        ? `The modern code has ${diagnostics.length} type errors. First ${shown.length}:`
        : `The modern code has ${diagnostics.length} type error${diagnostics.length === 1 ? '' : 's'}:`;
    return { ok: false, code: 'MODERN_COMPILE_ERROR', message: [header, ...shown].join('\n') };
  }

  const js = ts.transpileModule(code, {
    compilerOptions: TRANSPILE_OPTIONS,
    fileName: MODULE_FILE,
  }).outputText;
  return { ok: true, js };
}

/**
 * Loads Modern_Code (Requirement 5): rejects imports, type-checks under `strict`, transpiles to
 * CommonJS, and evaluates the result in a fresh sandbox, separate from the legacy one.
 *
 * `timeoutMs` bounds the top-level code of the transpiled module.
 */
export function loadModern(code: string, entryFunction: string, timeoutMs: number): LoadResult {
  const compiled = compileModernCode(code, entryFunction);
  if (!compiled.ok) return loadFailure(compiled.code, compiled.message);

  // `exports` is created inside the sandbox, so no host object is reachable through it.
  const sandbox = createSandbox();
  sandbox.evaluate('var exports = {};', 'exports.js', timeoutMs);
  const readEntry = createEntryReader(sandbox, 'exports', timeoutMs);

  try {
    sandbox.evaluate(compiled.js, 'modern.js', timeoutMs);
  } catch (error) {
    return loadFailure('MODERN_LOAD_ERROR', describeThrown(error));
  }

  const fn = readEntry(entryFunction, timeoutMs);
  if (fn === undefined) {
    return loadFailure('ENTRY_FUNCTION_NOT_FOUND', missingEntryMessage(entryFunction, 'modern'));
  }
  return { ok: true, value: { sandbox, fn } };
}
