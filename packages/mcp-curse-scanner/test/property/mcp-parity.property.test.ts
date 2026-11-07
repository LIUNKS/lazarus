import fc from 'fast-check';
import { describe, it } from 'vitest';
import { extractFunctionSignatures, scanCurses } from '../../src/lib.ts';
import { callTool, type ServerDeps } from '../../src/server/tools.ts';
import { injectedProgram } from '../support/clean-corpus.ts';
import { connect, textOf } from '../support/mcp.ts';

const deps: ServerDeps = { scan: scanCurses, extract: extractFunctionSignatures, log: () => undefined };
const language = fc.constantFrom('es3', 'es5-jquery', 'legacy-node' as const);

describe('library and MCP parity', () => {
  it('R14.5 callTool returns the JSON of the library result, with isError exactly for a Scan_Error', () => {
    // Feature: 02-scanner-and-verifier, Property 13: Library and MCP parity
    fc.assert(
      fc.property(fc.oneof(injectedProgram.map((p) => p.source), fc.string({ maxLength: 200 })), language, (source, lang) => {
        const pairs = [
          ['scan_ast_curses', scanCurses(source, lang)],
          ['extract_function_signatures', extractFunctionSignatures(source, lang)],
        ] as const;
        return pairs.every(([name, expected]) => {
          const result = callTool(name, { source, sourceLanguage: lang }, deps);
          return (
            textOf(result) === JSON.stringify(expected) &&
            result.content.length === 1 &&
            (expected.ok ? result.isError === undefined : result.isError === true)
          );
        });
      }),
      { numRuns: 150 },
    );
  });

  it('R14.6 the same holds through a real client and server over an in-memory transport', async () => {
    // Feature: 02-scanner-and-verifier, Supporting check: Library and MCP parity over a round trip
    const connection = await connect();
    try {
      await fc.assert(
        fc.asyncProperty(injectedProgram, language, async (program, lang) => {
          const result = await connection.client.callTool({
            name: 'scan_ast_curses',
            arguments: { source: program.source, sourceLanguage: lang },
          });
          return textOf(result as { content: unknown }) === JSON.stringify(scanCurses(program.source, lang));
        }),
        { numRuns: 25 },
      );
    } finally {
      await connection.close();
    }
  });
});
