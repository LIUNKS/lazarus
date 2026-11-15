import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { requireBuild, workspaceRoot } from '../support/paths.ts';
import { RawServer } from '../support/raw-server.ts';

interface Registration {
  command: string;
  args: string[];
  env: Record<string, string>;
  autoApprove: string[];
}

// Read only: the agent never edits .kiro/settings/mcp.json.
const registration = (
  JSON.parse(readFileSync(join(workspaceRoot, '.kiro', 'settings', 'mcp.json'), 'utf8')) as {
    mcpServers: Record<string, Registration>;
  }
).mcpServers['lazarus-curse-scanner']!;

let running: RawServer | undefined;
beforeAll(requireBuild);
afterEach(() => running?.kill());

const call = { name: 'scan_ast_curses', arguments: { source: 'var a = 1;\nb == c;', sourceLanguage: 'es5-jquery' } };

async function resultUnder(nodeEnv: string | undefined): Promise<string> {
  const env: Record<string, string> = { ...getDefaultEnvironment() };
  if (nodeEnv !== undefined) env.NODE_ENV = nodeEnv;
  running = new RawServer({ env });
  await running.initialize();
  const response = await running.request(2, 'tools/call', call);
  running.kill();
  return JSON.stringify(response.result);
}

describe('Registration in .kiro/settings/mcp.json', () => {
  it('R16.1 points at the built server entry', () => {
    expect(registration.command).toBe('node');
    expect(registration.args).toEqual(['./packages/mcp-curse-scanner/dist/index.js']);
  });

  it('R16.2 autoApprove equals the tool names reported by tools/list, as an unordered set', async () => {
    running = new RawServer();
    await running.initialize();
    const list = await running.request(2, 'tools/list');
    const names = (list.result as unknown as { tools: { name: string }[] }).tools.map((tool) => tool.name);
    expect(new Set(registration.autoApprove)).toEqual(new Set(names));
  });

  it('R16.3 the registered command line answers initialize within 10,000 ms from the Workspace_Root', async () => {
    running = new RawServer({
      command: registration.command,
      args: registration.args,
      env: { ...getDefaultEnvironment(), NODE_ENV: 'development' },
    });
    const started = Date.now();
    const response = await running.initialize();
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(response.result).toMatchObject({ serverInfo: { name: 'lazarus-curse-scanner' } });
  });

  it('R15.9 a tool call gives the same result with NODE_ENV unset, development, production, and test', async () => {
    const results = [];
    for (const nodeEnv of [undefined, 'development', 'production', 'test']) results.push(await resultUnder(nodeEnv));
    expect(new Set(results).size).toBe(1);
  });
});
