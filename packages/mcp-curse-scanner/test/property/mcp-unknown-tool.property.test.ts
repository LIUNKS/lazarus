import fc from 'fast-check';
import { describe, it, vi } from 'vitest';
import { connect, rawCall } from '../support/mcp.ts';

const KNOWN = ['scan_ast_curses', 'extract_function_signatures'];

describe('unknown tool names', () => {
  it('R14.9 never reach the scanner, never echo the name, and leave the server able to answer', async () => {
    // Feature: 02-scanner-and-verifier, Property 15: Unknown tool names never reach the scanner
    const scan = vi.fn();
    const extract = vi.fn();
    const connection = await connect({ scan, extract, log: () => undefined });
    try {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 8, maxLength: 40 }).filter((name) => !KNOWN.includes(name) && !'MCP error -32602: Unknown tool'.includes(name)),
          async (name) => {
            let error: { code?: number; message?: string } | undefined;
            try {
              await rawCall(connection.client, name, { source: 'var a;', sourceLanguage: 'es3' });
            } catch (caught) {
              error = caught as { code?: number; message?: string };
            }
            const next = await connection.client.listTools();
            return (
              error?.code === -32602 &&
              !(error.message ?? '').includes(name) &&
              scan.mock.calls.length === 0 &&
              extract.mock.calls.length === 0 &&
              next.tools.length === 2
            );
          },
        ),
        { numRuns: 100 },
      );
    } finally {
      await connection.close();
    }
  });
});
