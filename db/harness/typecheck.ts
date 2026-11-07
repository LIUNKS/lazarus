// In-memory strict type-check and CommonJS transpile of a self-contained TypeScript module.
// Requires the importable TypeScript compiler API (typescript@^6; 7.x does not ship it).
import ts from 'typescript';

const MODULE_FILE = 'module.ts';

const checkOptions: ts.CompilerOptions = {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2022.d.ts'],
  types: [],
  noEmit: true,
  skipLibCheck: true,
};

/** Returns rendered error diagnostics (`line:column TSxxxx message`). Empty means the module compiles. */
export function typecheckStrict(code: string): string[] {
  const host = ts.createCompilerHost(checkOptions);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreate) =>
    fileName === MODULE_FILE
      ? ts.createSourceFile(fileName, code, ts.ScriptTarget.ES2022, true)
      : originalGetSourceFile(fileName, languageVersionOrOptions, onError, shouldCreate);
  host.fileExists = (fileName) => fileName === MODULE_FILE || ts.sys.fileExists(fileName);
  host.readFile = (fileName) => (fileName === MODULE_FILE ? code : ts.sys.readFile(fileName));
  host.writeFile = () => {
    throw new Error('The type-check must not write files.');
  };

  const program = ts.createProgram([MODULE_FILE], checkOptions, host);
  const diagnostics = [
    ...program.getOptionsDiagnostics(),
    ...program.getSyntacticDiagnostics(),
    ...program.getGlobalDiagnostics(),
    ...program.getSemanticDiagnostics(),
  ].filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);

  return diagnostics.map((diagnostic) => {
    const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    if (diagnostic.file === undefined || diagnostic.start === undefined) {
      return `TS${diagnostic.code} ${text}`;
    }
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    return `${line + 1}:${character + 1} TS${diagnostic.code} ${text}`;
  });
}

export function transpileToCommonJs(code: string): string {
  return ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
