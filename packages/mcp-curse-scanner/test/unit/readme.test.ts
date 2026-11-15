import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/lib.ts';
import { CURSE_TABLE, CURSE_TYPE_ORDER, SOURCE_LANGUAGES } from '../../src/scanner/constants.ts';
import { distLib, packageRoot } from '../support/paths.ts';

const readme = readFileSync(join(packageRoot, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
const FORBIDDEN_PHRASES = ['100%', 'mathematical proof', 'mathematically proven', 'guaranteed'];
const HEADINGS = [
  'Overview',
  'Build and test',
  'Library usage',
  'Detection rules',
  'Result and error formats',
  'Limits',
  'MCP tools',
  'Enabling the MCP server in Kiro',
];

/** Level-2 sections: heading title and body text. Lines inside code fences are never headings. */
function sections(): Map<string, string> {
  const result = new Map<string, string>();
  let title: string | null = null;
  let body: string[] = [];
  let inFence = false;
  for (const line of readme.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    const heading = !inFence ? /^## (.+)$/.exec(line) : null;
    if (heading) {
      if (title !== null) result.set(title, body.join('\n'));
      title = heading[1]!;
      body = [];
    } else if (title !== null) {
      body.push(line);
    }
  }
  if (title !== null) result.set(title, body.join('\n'));
  return result;
}

const byTitle = sections();
const section = (title: string): string => byTitle.get(title) ?? '';

/** Rows of the first Markdown table in a text, without the header and separator rows. */
function tableRows(text: string): string[][] {
  const lines = text.split('\n').filter((line) => line.startsWith('|'));
  return lines.slice(2).map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
}

const unquote = (cell: string): string => cell.replace(/^`|`$/g, '');

function codeBlocks(text: string, language: string): string[] {
  return [...text.matchAll(new RegExp('```' + language + '\\n([\\s\\S]*?)```', 'g'))].map((match) => match[1]!);
}

describe('README', () => {
  it('R19.1 has exactly the eight level-2 headings, in order', () => {
    expect([...byTitle.keys()]).toEqual(HEADINGS);
  });

  it('R19.3 the Overview has 1 to 5 sentences and says the findings are static heuristics that can miss or over-report', () => {
    const overview = section('Overview').trim();
    const sentences = overview.split(/[.!?](?:\s|$)/).filter((part) => part.trim() !== '');
    expect(sentences.length).toBeGreaterThanOrEqual(1);
    expect(sentences.length).toBeLessThanOrEqual(5);
    expect(overview).toContain('static heuristics');
    expect(overview).toContain('miss or over-report');
  });

  it('R19.6 Build and test lists the Turborepo command run from the Workspace_Root', () => {
    const [block] = codeBlocks(section('Build and test'), 'sh');
    expect(block).toContain('pnpm exec turbo run build lint test --filter=@lazarus/mcp-curse-scanner');
  });

  it('R19.1 Detection rules has a six-row table in Curse_Type_Order with the Requirement 10.1 severities', () => {
    const rows = tableRows(section('Detection rules'));
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => unquote(row[0]!))).toEqual([...CURSE_TYPE_ORDER]);
    for (const [curseType, severity] of rows) expect(unquote(severity!)).toBe(CURSE_TABLE[unquote(curseType!) as keyof typeof CURSE_TABLE].severity);
  });

  it('R19.1 Result and error formats lists the five Scan_Error codes and the fields of the result objects', () => {
    const text = section('Result and error formats');
    for (const code of ['INVALID_INPUT', 'INPUT_TOO_LARGE', 'SYNTAX_ERROR', 'LIMIT_EXCEEDED', 'TIMEOUT']) expect(text).toContain(`\`${code}\``);
    for (const field of ['ok', 'sourceLanguage', 'lineCount', 'curses', 'curseType', 'severity', 'lineNumber', 'column', 'description', 'exorcismStrategy', 'code', 'message']) {
      expect(text, field).toContain(`\`${field}\``);
    }
  });

  it('R19.1 Limits lists the four numeric limits with the values of LIMITS', () => {
    const rows = tableRows(section('Limits')).map((row) => row.join(' | '));
    const format = (value: number): string => value.toLocaleString('en-US');
    expect(rows).toEqual([
      `Source size | ${format(LIMITS.sourceSizeBytes)} bytes of UTF-8`,
      `Syntax tree nodes | ${format(LIMITS.nodes)}`,
      `Syntax tree depth | ${LIMITS.depth} levels`,
      `Time budget per scan | ${format(LIMITS.timeBudgetMs)} ms`,
    ]);
  });

  it('R19.1 MCP tools lists both tools and an input schema that matches the real one', () => {
    const text = section('MCP tools');
    expect(text).toContain('### `scan_ast_curses`');
    expect(text).toContain('### `extract_function_signatures`');
    const [schemaText] = codeBlocks(text, 'json');
    const schema = JSON.parse(schemaText!) as {
      properties: { source: { type: string; maxLength: number }; sourceLanguage: { enum: string[] } };
      required: string[];
      additionalProperties: boolean;
    };
    expect(schema.properties.source).toEqual({ type: 'string', maxLength: LIMITS.sourceSizeBytes });
    expect(schema.properties.sourceLanguage.enum).toEqual([...SOURCE_LANGUAGES]);
    expect(schema.required).toEqual(['source', 'sourceLanguage']);
    expect(schema.additionalProperties).toBe(false);
  });

  it('R16.4 R16.5 R19.2 the last section has the three steps in order and says the Registration stays disabled until dist/index.js exists', () => {
    const text = section('Enabling the MCP server in Kiro');
    const steps = text.split('\n').filter((line) => /^\d+\. /.test(line));
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatch(/^1\. .*`pnpm build`/);
    expect(steps[1]).toMatch(/^2\. .*`\.kiro\/settings\/mcp\.json`.*`"disabled": true`.*`"disabled": false`.*`lazarus-curse-scanner`/);
    expect(steps[2]).toMatch(/^3\. .*[Rr]eload the MCP servers in Kiro/);
    expect(text).toContain('stays `"disabled": true` until the file `packages/mcp-curse-scanner/dist/index.js` exists');
    expect(text).toContain('Do not set `"disabled": false` before `pnpm build` has completed successfully');
  });

  it('R13.14 says that pureCandidate is a static heuristic that does not prove purity or determinism', () => {
    expect(readme).toMatch(/`pureCandidate` is a static heuristic/);
    expect(readme).toContain('does not prove purity or determinism');
  });

  it('R19.5 contains none of the Forbidden_Phrases, compared case-insensitively', () => {
    const lower = readme.toLowerCase();
    for (const phrase of FORBIDDEN_PHRASES) expect(lower, phrase).not.toContain(phrase);
  });

  it('R19.4 is written in English: printable ASCII only', () => {
    expect(readme).toMatch(/^[\t\n\x20-\x7E]*$/);
  });
});

describe('README code examples', () => {
  const examples = codeBlocks(section('Library usage'), 'ts');
  const declarations = distLib.replace(/\.js$/, '.d.ts');

  beforeAll(() => {
    // The examples compile against the emitted declarations, so a build must exist.
    expect(() => readFileSync(declarations)).not.toThrow();
  });

  it('R19.1 Library usage has one scanCurses example and one extractFunctionSignatures example', () => {
    expect(examples).toHaveLength(2);
    expect(examples[0]).toContain('scanCurses(');
    expect(examples[1]).toContain('extractFunctionSignatures(');
    for (const example of examples) {
      expect(example).toMatch(/^import \{ \w+ \} from '@lazarus\/mcp-curse-scanner';/);
      expect(example).toContain('!result.ok');
    }
  });

  it('R19.7 the examples compile without type errors against the emitted declarations', () => {
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2023,
      lib: ['lib.es2023.d.ts'],
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: ['node'],
      paths: { '@lazarus/mcp-curse-scanner': [declarations.replace(/\\/g, '/')] },
    };
    // The compiler host uses forward slashes on every platform, so the virtual file names do too.
    const virtual = new Map(
      examples.map((code, index) => [join(packageRoot, `readme-example-${index}.ts`).replace(/\\/g, '/'), code]),
    );
    const host = ts.createCompilerHost(options);
    const { readFile, fileExists, getSourceFile } = host;
    host.fileExists = (file) => virtual.has(file) || fileExists.call(host, file);
    host.readFile = (file) => virtual.get(file) ?? readFile.call(host, file);
    host.getSourceFile = (file, languageVersion, onError, shouldCreate) =>
      virtual.has(file)
        ? ts.createSourceFile(file, virtual.get(file)!, languageVersion, true)
        : getSourceFile.call(host, file, languageVersion, onError, shouldCreate);

    const program = ts.createProgram([...virtual.keys()], options, host);
    const messages = ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    expect(messages).toEqual([]);
  });
});
