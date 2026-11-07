import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { callTool, type ServerDeps } from '../../src/server/tools.ts';

const CONSTANT_TEXT = 'Internal error while handling the tool call.';

describe('exceptions', () => {
  it('R14.10 the constant text has 44 characters', () => {
    expect(CONSTANT_TEXT).toHaveLength(44);
  });

  it('R14.10 become the same constant isError result, whatever the exception or the source says', () => {
    // Feature: 02-scanner-and-verifier, Property 16: Exceptions become a constant result
    fc.assert(
      fc.property(
        fc.constantFrom('scan_ast_curses', 'extract_function_signatures'),
        fc.string({ minLength: 1, maxLength: 60 }),
        fc.string({ maxLength: 60 }),
        (name, source, extra) => {
          const fail = (): never => {
            throw new Error(`${source} ${extra}`);
          };
          const deps: ServerDeps = { scan: fail, extract: fail, log: () => undefined };
          const result = callTool(name, { source, sourceLanguage: 'es3' }, deps);
          const text = (result.content[0] as { text: string }).text;
          return result.isError === true && result.content.length === 1 && text === CONSTANT_TEXT;
        },
      ),
      { numRuns: 200 },
    );
  });
});
