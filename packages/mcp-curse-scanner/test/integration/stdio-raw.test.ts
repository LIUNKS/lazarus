import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireBuild } from '../support/paths.ts';
import { RawServer } from '../support/raw-server.ts';

const TOOLS = ['scan_ast_curses', 'extract_function_signatures'];
let server: RawServer;

beforeEach(() => {
  requireBuild();
  server = new RawServer();
});
afterEach(() => server.kill());

describe('built server over raw stdio', () => {
  it('R2.9 R15.7 writes nothing to stdout before the first request and keeps running without a module error', async () => {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(server.stdout).toBe('');
    expect(server.child.exitCode).toBeNull();
    expect(server.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find module/);
  });

  it('R14.12 R15.4 every stdout line is one complete JSON-RPC 2.0 message', async () => {
    await server.initialize();
    await server.request(2, 'tools/list');
    await server.request(3, 'tools/call', { name: 'scan_ast_curses', arguments: { source: 'var a;', sourceLanguage: 'es3' } });
    expect(server.lines.length).toBeGreaterThanOrEqual(3);
    for (const line of server.lines) expect(JSON.parse(line)).toMatchObject({ jsonrpc: '2.0' });
  });

  it('R15.6 a marker in a source or in an invalid argument never reaches stderr or another response', async () => {
    const markerA = 'LzMarkerAlpha731';
    const markerB = 'LzMarkerBeta942';
    await server.initialize();
    const scan = await server.request(10, 'tools/call', { name: 'scan_ast_curses', arguments: { source: `var ${markerA} = "${markerA}";`, sourceLanguage: 'es3' } });
    const invalid = await server.request(11, 'tools/call', { name: 'scan_ast_curses', arguments: { source: markerB, sourceLanguage: markerB } });
    expect(invalid.result?.isError).toBe(true);
    expect(JSON.stringify(invalid)).not.toContain(markerB);
    for (const marker of [markerA, markerB]) expect(server.stderr).not.toContain(marker);
    for (const line of server.lines) {
      if (line.includes(markerA)) expect(JSON.parse(line).id).toBe(scan.id);
    }
  });

  it('R14.12 exits with code 0 within 5,000 ms after stdin closes', async () => {
    await server.initialize();
    const { code, ms } = await server.closeAndWait(5_000);
    expect(code).toBe(0);
    expect(ms).toBeLessThan(5_000);
  });

  it('R14.8 R15.10 a non-object `arguments` gets InvalidParams (-32602), is never scanned, and the server keeps working', async () => {
    const marker = 'LzMarkerGamma118';
    await server.initialize();
    const stderrBefore = server.stderr;
    let id = 100;
    for (const name of TOOLS) {
      for (const args of [marker, [], null, 1, true]) {
        const response = await server.request(id++, 'tools/call', { name, arguments: args });
        expect(response.error?.code, `${name} ${JSON.stringify(args)}`).toBe(-32602);
        expect(response).not.toHaveProperty('result');
      }
    }
    expect(server.stderr).toBe(stderrBefore);
    const next = await server.request(id++, 'tools/call', { name: 'scan_ast_curses', arguments: { source: 'var a;', sourceLanguage: 'es3' } });
    expect(next.error).toBeUndefined();
    expect(next.result?.isError).toBeUndefined();
  });

  it('R14.8 absent `arguments` is a tool-level isError result that names `arguments`', async () => {
    await server.initialize();
    const response = await server.request(200, 'tools/call', { name: 'scan_ast_curses' });
    expect(response).not.toHaveProperty('error');
    expect(response.result?.isError).toBe(true);
    expect(response.result?.content?.[0]?.text).toContain('arguments');
  });
});
