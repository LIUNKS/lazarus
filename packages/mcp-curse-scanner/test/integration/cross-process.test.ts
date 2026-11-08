import { execFileSync } from 'node:child_process';
import * as acorn from 'acorn';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SourceLanguage } from '../../src/lib.ts';
import { renderProgram } from '../support/clean-corpus.ts';
import { CURSE_CORPUS } from '../support/curse-corpus.ts';
import { measureTree, parseDirect } from '../support/depth-capability.ts';
import { distLib, requireBuild } from '../support/paths.ts';
import { loadSeedSamples } from '../support/seed-loader.ts';

interface ScanInput {
  label: string;
  source: string;
  language: SourceLanguage;
  /** False for the inputs that do not parse (syntax error, size). */
  parses: boolean;
}

// A fixed program of the Clean_Corpus grammar: a deterministic tape, so the input never changes between runs.
const fixedTape = Array.from({ length: 170 }, (_, index) => (index * 37 + 11) % 100);
const cleanLines = renderProgram(fixedTape).lines;

function buildInputs(): ScanInput[] {
  const inputs: ScanInput[] = CURSE_CORPUS.map((testCase) => ({
    label: `corpus ${testCase.requirement} ${testCase.id}`,
    source: testCase.source,
    language: testCase.language,
    parses: true,
  }));
  for (const sample of loadSeedSamples().samples) {
    inputs.push({ label: `seed ${sample.folder}`, source: sample.legacy, language: sample.sourceLanguage, parses: true });
  }
  inputs.push(
    { label: 'clean program', source: cleanLines.join('\n'), language: 'es5-jquery', parses: true },
    { label: 'syntax error', source: 'var a = 1;\nvar = ;\n', language: 'es5-jquery', parses: false },
    { label: 'input too large', source: 'a'.repeat(1_048_577), language: 'es3', parses: false },
    // 200,001 nodes with a depth of 2: LIMIT_EXCEEDED comes from the node count, not from the stack.
    { label: 'flat 200,001 nodes', source: ';'.repeat(200_000), language: 'es5-jquery', parses: true },
  );
  return inputs;
}

// Runs the built library in a separate Node process under the given TZ and LANG, and returns its JSON text.
function runInChildProcess(inputs: ScanInput[], environment: { TZ: string; LANG: string }): string {
  const script = `
    import { scanCurses, extractFunctionSignatures } from ${JSON.stringify(pathToFileURL(distLib).href)};
    let text = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) text += chunk;
    const inputs = JSON.parse(text);
    const results = inputs.map((input) => [
      scanCurses(input.source, input.language),
      extractFunctionSignatures(input.source, input.language),
    ]);
    process.stdout.write(JSON.stringify(results));
  `;
  return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    input: JSON.stringify(inputs.map(({ source, language }) => ({ source, language }))),
    env: { ...getDefaultEnvironment(), ...environment },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 60_000,
  });
}

function treeDepth(input: ScanInput): number {
  const tree =
    input.language === 'legacy-node'
      ? acorn.parse(input.source, { ecmaVersion: 5, sourceType: 'script', allowHashBang: true, allowReturnOutsideFunction: true })
      : parseDirect(input.source, input.language);
  return measureTree(tree).depth;
}

beforeAll(requireBuild);

describe('cross-process determinism', () => {
  const inputs = buildInputs();

  it('R11.6 every parsing input has a syntax tree of depth at most 40, so none is a Stack_Limit_Source', () => {
    const deep = inputs.filter((input) => input.parses).map((input) => ({ label: input.label, depth: treeDepth(input) })).filter((item) => item.depth > 40);
    expect(deep).toEqual([]);
  });

  it('R11.6 the inputs cover the corpus, the three seed files, a clean program, and the three error cases', () => {
    const labels = inputs.map((input) => input.label);
    expect(labels.filter((label) => label.startsWith('seed '))).toHaveLength(3);
    expect(labels).toEqual(expect.arrayContaining(['clean program', 'syntax error', 'input too large', 'flat 200,001 nodes']));
    expect(inputs.length).toBeGreaterThan(CURSE_CORPUS.length);
  });

  it('R11.6 R12.8 two processes with different TZ and LANG return byte-identical JSON for every input', () => {
    const first = runInChildProcess(inputs, { TZ: 'UTC', LANG: 'en_US.UTF-8' });
    const second = runInChildProcess(inputs, { TZ: 'Pacific/Auckland', LANG: 'ja_JP.UTF-8' });
    expect(second).toBe(first);

    const results = JSON.parse(first) as { ok: boolean; code?: string }[][];
    const codeOf = (label: string): string | undefined => results[inputs.findIndex((input) => input.label === label)]![0]!.code;
    expect(codeOf('syntax error')).toBe('SYNTAX_ERROR');
    expect(codeOf('input too large')).toBe('INPUT_TOO_LARGE');
    expect(codeOf('flat 200,001 nodes')).toBe('LIMIT_EXCEEDED');
    expect(codeOf('clean program')).toBeUndefined();
  });
});
