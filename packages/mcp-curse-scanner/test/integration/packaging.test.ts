import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import { distLib, packageRoot, requireBuild, workspaceRoot } from '../support/paths.ts';

interface PackageJson {
  type?: string;
  exports: Record<string, Record<string, string>>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as PackageJson;
const distDir = join(packageRoot, 'dist');

function filesUnder(dir: string, extension: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : filesUnder(path, extension);
    return path.endsWith(extension) ? [path] : [];
  });
}

/** Module specifiers of the import and export declarations and of the import() and require() calls of a file. */
function specifiersOf(file: string): string[] {
  const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2023, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node)) {
      const [first] = node.arguments;
      const isImportCall = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isImportCall || isRequire) && first && ts.isStringLiteralLike(first)) found.push(first.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

const packageNameOf = (specifier: string): string => {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
};

beforeAll(requireBuild);

describe('packaging', () => {
  it('R2.3 every file referenced by the exports field exists after the build', () => {
    const targets = Object.values(pkg.exports).flatMap((conditions) => Object.values(conditions));
    expect(targets.length).toBeGreaterThan(0);
    for (const target of new Set(targets)) expect(existsSync(join(packageRoot, target)), target).toBe(true);
  });

  it('R2.5 no import specifier in dist/ resolves outside the package, and no file mentions db/, scripts/, or .kiro/', () => {
    const files = filesUnder(distDir, '.js');
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      for (const specifier of specifiersOf(file).filter((item) => item.startsWith('.'))) {
        const target = resolve(dirname(file), specifier);
        expect(target.startsWith(packageRoot.replace(/[\\/]$/, '') + sep), `${file} imports ${specifier}`).toBe(true);
      }
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/(^|[^A-Za-z0-9_])(db|scripts)\//);
      expect(text, file).not.toContain('.kiro/');
    }
  });

  it('R2.7 every .js file in dist/ is ESM and package.json declares "type": "module"', () => {
    expect(pkg.type).toBe('module');
    for (const file of filesUnder(distDir, '.js')) {
      const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2023, true);
      const commonJs: string[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') commonJs.push('require()');
        if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
          if (node.expression.text === 'module' && node.name.text === 'exports') commonJs.push('module.exports');
          if (node.expression.text === 'exports') commonJs.push(`exports.${node.name.text}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(tree);
      expect(commonJs, file).toEqual([]);
    }
  });

  it('R2.4 importing the library entry writes 0 bytes to stdout and stderr and starts no server', () => {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', `import ${JSON.stringify(pathToFileURL(distLib).href)};`], {
      cwd: workspaceRoot,
      input: '',
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe('');
    expect(run.stderr).toBe('');
  });

  it('R2.6 git ignores packages/mcp-curse-scanner/dist', () => {
    // check-ignore exits with code 0 when the path is ignored and with 1 otherwise, which makes execFileSync throw.
    expect(() =>
      execFileSync('git', ['check-ignore', '-q', 'packages/mcp-curse-scanner/dist'], { cwd: workspaceRoot, stdio: 'ignore' }),
    ).not.toThrow();
  });

  it('R1.6 the resolved compiler options of tsconfig.json have strict set to true', () => {
    const configPath = join(packageRoot, 'tsconfig.json');
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    expect(read.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, packageRoot);
    expect(parsed.options.strict).toBe(true);
  });

  it('R1.7 the lint configuration reports no-explicit-any for a test file and for a source file', async () => {
    const eslint = new ESLint({ cwd: packageRoot });
    for (const file of [join(packageRoot, 'test', 'unit', 'virtual.test.ts'), join(packageRoot, 'src', 'virtual.ts')]) {
      const [result] = await eslint.lintText('export const value: any = 1;\n', { filePath: file });
      expect(result?.messages.map((message) => message.ruleId), file).toContain('@typescript-eslint/no-explicit-any');
    }
  });

  it('R18.12 R18.13 the package turbo.json makes test depend on build, caches it, and lists the seed globs as inputs', () => {
    const turbo = JSON.parse(readFileSync(join(packageRoot, 'turbo.json'), 'utf8')) as {
      tasks: { test: { dependsOn: string[]; cache: boolean; inputs: string[] } };
    };
    expect(turbo.tasks.test.dependsOn).toContain('build');
    expect(turbo.tasks.test.cache).toBe(true);
    expect(turbo.tasks.test.inputs).toEqual(
      expect.arrayContaining(['$TURBO_DEFAULT$', '$TURBO_ROOT$/db/seed/*/legacy.js', '$TURBO_ROOT$/db/seed/*/sample.json']),
    );
  });

  it('R1.9 package.json declares every third-party module imported by src/ and test/, and at least the four required ones', () => {
    const declared = new Set([...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)]);
    const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
    const files = [...filesUnder(join(packageRoot, 'src'), '.ts'), ...filesUnder(join(packageRoot, 'test'), '.ts'), join(packageRoot, 'vitest.config.ts')];
    const missing = new Set<string>();
    for (const file of files) {
      for (const specifier of specifiersOf(file)) {
        if (specifier.startsWith('.') || builtins.has(specifier) || builtins.has(specifier.split('/')[0]!)) continue;
        const name = packageNameOf(specifier);
        if (!declared.has(name)) missing.add(`${name} (imported by ${file})`);
      }
    }
    expect([...missing]).toEqual([]);
    for (const required of ['acorn', '@modelcontextprotocol/sdk', 'zod', 'fast-check']) expect(declared.has(required), required).toBe(true);
  });
});
