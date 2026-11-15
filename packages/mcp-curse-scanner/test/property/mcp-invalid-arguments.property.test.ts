import fc from 'fast-check';
import { describe, it } from 'vitest';
import { callTool, type ServerDeps } from '../../src/server/tools.ts';

const LANGUAGES = ['es3', 'es5-jquery', 'legacy-node'];
const KEY = fc.stringMatching(/^[a-z]{1,10}$/);
const PREFIX = 'Invalid arguments: ';

// Values for `source` and `sourceLanguage`: sometimes valid, sometimes not, sometimes absent.
const value = fc.oneof(
  fc.string({ maxLength: 20 }),
  fc.constantFrom(...LANGUAGES),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.array(fc.string(), { maxLength: 2 }),
);
const args = fc.oneof(
  fc.constant(undefined),
  fc.record({ source: value, sourceLanguage: value }, { requiredKeys: [] }).chain((base) =>
    fc.dictionary(KEY, value, { maxKeys: 3 }).map((extra) => ({ ...extra, ...base })),
  ),
);

function expectedNames(input: unknown): string[] | null {
  if (input === undefined) return ['arguments'];
  const record = input as Record<string, unknown>;
  const names = Object.keys(record).filter((key) => key !== 'source' && key !== 'sourceLanguage');
  if (typeof record.source !== 'string') names.push('source');
  if (typeof record.sourceLanguage !== 'string' || !LANGUAGES.includes(record.sourceLanguage)) names.push('sourceLanguage');
  return names.length === 0 ? null : names.sort();
}

describe('invalid tool arguments', () => {
  it('R14.8 are rejected by name before scanning, and valid ones reach the scanner', () => {
    // Feature: 02-scanner-and-verifier, Property 14: Invalid tool arguments are rejected by name before scanning
    fc.assert(
      fc.property(fc.constantFrom('scan_ast_curses', 'extract_function_signatures'), args, (name, input) => {
        let calls = 0;
        const deps: ServerDeps = {
          scan: () => (calls++, { ok: true, sourceLanguage: 'es3', lineCount: 1, curses: [] }),
          extract: () => (calls++, { ok: true, sourceLanguage: 'es3', lineCount: 1, functions: [] }),
          log: () => undefined,
        };
        const result = callTool(name, input, deps);
        const text = (result.content[0] as { text: string }).text;
        const names = expectedNames(input);
        if (names === null) return calls === 1 && result.isError === undefined && !text.startsWith(PREFIX);
        return (
          calls === 0 &&
          result.isError === true &&
          text.startsWith(PREFIX) &&
          JSON.stringify(text.slice(PREFIX.length).split(', ').sort()) === JSON.stringify([...new Set(names)].sort())
        );
      }),
      { numRuns: 300 },
    );
  });
});
