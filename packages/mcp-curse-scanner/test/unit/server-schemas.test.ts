import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type Connection } from '../support/mcp.ts';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

let connection: Connection;
beforeAll(async () => {
  connection = await connect({}, pkg.version);
});
afterAll(async () => {
  await connection.close();
});

describe('tool list and schemas', () => {
  it('R14.1 lists exactly the two tools', async () => {
    const { tools } = await connection.client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['extract_function_signatures', 'scan_ast_curses']);
  });

  it('R14.2 every description is 1 to 500 characters', async () => {
    const { tools } = await connection.client.listTools();
    for (const tool of tools) {
      expect(tool.description!.length).toBeGreaterThanOrEqual(1);
      expect(tool.description!.length).toBeLessThanOrEqual(500);
    }
  });

  it('R14.3 the input schema is strict, requires both properties, and carries the limits', async () => {
    const { tools } = await connection.client.listTools();
    for (const tool of tools) {
      const schema = tool.inputSchema as {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: Record<string, { maxLength?: number; enum?: string[]; type: string }>;
      };
      expect(schema.type).toBe('object');
      expect(schema.additionalProperties).toBe(false);
      expect([...schema.required].sort()).toEqual(['source', 'sourceLanguage']);
      expect(schema.properties.source).toMatchObject({ type: 'string', maxLength: 1_048_576 });
      expect(schema.properties.sourceLanguage!.enum).toEqual(['es3', 'es5-jquery', 'legacy-node']);
    }
  });

  it('R15.3 no property name or description mentions a path, directory, URL, or command', async () => {
    const { tools } = await connection.client.listTools();
    for (const tool of tools) {
      const text = JSON.stringify([Object.keys((tool.inputSchema as { properties: object }).properties), tool.inputSchema]).toLowerCase();
      for (const word of ['path', 'directory', 'url', 'command', 'file']) expect(text).not.toContain(word);
    }
  });

  it('R14.14 initialize reports the server name and the package.json version', () => {
    expect(connection.client.getServerVersion()).toMatchObject({ name: 'lazarus-curse-scanner', version: pkg.version });
  });
});
