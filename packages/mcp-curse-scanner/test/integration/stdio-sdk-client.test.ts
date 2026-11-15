import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { distEntry, requireBuild, workspaceRoot } from '../support/paths.ts';

let client: Client;

const text = (result: { content: unknown }): string => (result.content as { text: string }[])[0]!.text;

beforeAll(async () => {
  requireBuild();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [distEntry],
    cwd: workspaceRoot,
    stderr: 'pipe',
    env: { NODE_ENV: 'development' },
  });
  client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  await client?.close();
});

describe('built server through the SDK client over stdio', () => {
  it('R14.5 lists the two tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['extract_function_signatures', 'scan_ast_curses']);
  });

  it('R14.5 scan_ast_curses returns findings for valid arguments', async () => {
    const result = await client.callTool({ name: 'scan_ast_curses', arguments: { source: 'var a = 1;', sourceLanguage: 'es5-jquery' } });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(text(result as { content: unknown }))).toMatchObject({ ok: true, curses: [{ curseType: 'VAR_HOISTING' }] });
  });

  it('R14.6 extract_function_signatures returns signatures for valid arguments', async () => {
    const result = await client.callTool({
      name: 'extract_function_signatures',
      arguments: { source: 'function f(a) { return a; }', sourceLanguage: 'es3' },
    });
    expect(JSON.parse(text(result as { content: unknown }))).toMatchObject({ ok: true, functions: [{ name: 'f', params: ['a'] }] });
  });

  it('R14.8 arguments that fail the schema give an isError result, each naming the property', async () => {
    const cases: [object | undefined, string][] = [
      [{ source: 5, sourceLanguage: 'es3' }, 'source'],
      [{ source: 'a', sourceLanguage: 'nope' }, 'sourceLanguage'],
      [{ source: 'a', sourceLanguage: 'es3', extra: true }, 'extra'],
      [undefined, 'arguments'],
    ];
    for (const [args, name] of cases) {
      const params = args === undefined ? { name: 'scan_ast_curses' } : { name: 'scan_ast_curses', arguments: args };
      const result = await client.request({ method: 'tools/call', params } as never, CallToolResultSchema);
      expect(result.isError).toBe(true);
      expect(text(result)).toBe(`Invalid arguments: ${name}`);
    }
  });

  it('R14.7 a syntax error gives an isError result with the position', async () => {
    const result = await client.callTool({ name: 'scan_ast_curses', arguments: { source: 'var 5;', sourceLanguage: 'es3' } });
    expect(result.isError).toBe(true);
    expect(JSON.parse(text(result as { content: unknown }))).toMatchObject({ ok: false, code: 'SYNTAX_ERROR', line: 1, column: 5 });
  });

  it('R14.9 an unknown tool name gives a JSON-RPC error', async () => {
    await expect(client.callTool({ name: 'no_such_tool', arguments: {} })).rejects.toMatchObject({ code: -32602 });
  });
});
