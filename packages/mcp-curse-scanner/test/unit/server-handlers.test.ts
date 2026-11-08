import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScanResult, SignaturesResult } from '../../src/lib.ts';
import { connect, rawCall, textOf, type Connection } from '../support/mcp.ts';

const TOOLS = ['scan_ast_curses', 'extract_function_signatures'];

let connection: Connection | undefined;
afterEach(async () => {
  await connection?.close();
  connection = undefined;
});

function stubs() {
  const scan = vi.fn((): ScanResult => ({ ok: true, sourceLanguage: 'es3', lineCount: 1, curses: [] }));
  const extract = vi.fn((): SignaturesResult => ({ ok: true, sourceLanguage: 'es3', lineCount: 1, functions: [] }));
  const log = vi.fn();
  return { scan, extract, log };
}

describe('tool handlers', () => {
  it('R14.5 a success value is one text item with the JSON of the library result and no isError', async () => {
    connection = await connect();
    const result = await connection.client.callTool({
      name: 'scan_ast_curses',
      arguments: { source: 'a == b', sourceLanguage: 'es3' },
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(textOf(result as { content: unknown }))).toMatchObject({ ok: true, curses: [{ curseType: 'IMPLICIT_COERCION' }] });
  });

  it('R14.7 a Scan_Error result carries isError and one text item', async () => {
    connection = await connect();
    for (const name of TOOLS) {
      const result = await connection.client.callTool({ name, arguments: { source: 'var 5;', sourceLanguage: 'es3' } });
      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(JSON.parse(textOf(result as { content: unknown }))).toMatchObject({ ok: false, code: 'SYNTAX_ERROR', line: 1, column: 5 });
    }
  });

  it('R14.3 a source of 1,048,576 non-ASCII characters passes the schema and gives INPUT_TOO_LARGE', async () => {
    connection = await connect();
    const result = await connection.client.callTool({
      name: 'scan_ast_curses',
      arguments: { source: '\u00e9'.repeat(1_048_576), sourceLanguage: 'es3' },
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(textOf(result as { content: unknown }))).toMatchObject({ code: 'INPUT_TOO_LARGE' });
  });

  it('R14.3 a source of 1,048,577 characters is rejected by the schema, before scanning', async () => {
    const deps = stubs();
    connection = await connect(deps);
    const result = await connection.client.callTool({
      name: 'scan_ast_curses',
      arguments: { source: 'a'.repeat(1_048_577), sourceLanguage: 'es3' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result as { content: unknown })).toBe('Invalid arguments: source');
    expect(deps.scan).not.toHaveBeenCalled();
  });

  it('R14.8 absent arguments give an isError result that names `arguments`', async () => {
    const deps = stubs();
    connection = await connect(deps);
    for (const name of TOOLS) {
      const result = await rawCall(connection.client, name);
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe('Invalid arguments: arguments');
    }
    expect(deps.scan).not.toHaveBeenCalled();
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it('R14.8 a wrong type, a value outside the enum, a missing property, or an undeclared property names each property', async () => {
    const deps = stubs();
    connection = await connect(deps);
    const cases: [unknown, string][] = [
      [{ source: 5, sourceLanguage: 'es3' }, 'source'],
      [{ source: 'a', sourceLanguage: 'ES3' }, 'sourceLanguage'],
      [{ sourceLanguage: 'es3' }, 'source'],
      [{ source: 'a' }, 'sourceLanguage'],
      [{ source: 'a', sourceLanguage: 'es3', extra: 1 }, 'extra'],
      [{ source: 5, sourceLanguage: 'x', extra: 1, more: 2 }, 'extra, more, source, sourceLanguage'],
    ];
    for (const name of TOOLS) {
      for (const [args, names] of cases) {
        const result = await rawCall(connection.client, name, args);
        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe(`Invalid arguments: ${names}`);
      }
    }
    expect(deps.scan).not.toHaveBeenCalled();
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it('R14.8 a non-object `arguments` is rejected with InvalidParams (-32602), never scanned, and the server stays up', async () => {
    const deps = stubs();
    connection = await connect(deps);
    for (const name of TOOLS) {
      for (const args of ['x', [], null, 1, true]) {
        await expect(rawCall(connection.client, name, args), `${name} ${JSON.stringify(args)}`).rejects.toMatchObject({ code: -32602 });
      }
    }
    expect(deps.scan).not.toHaveBeenCalled();
    expect(deps.extract).not.toHaveBeenCalled();
    expect(deps.log).not.toHaveBeenCalled();

    const next = await rawCall(connection.client, 'scan_ast_curses', { source: 'var a;', sourceLanguage: 'es3' });
    expect(next.isError).toBeUndefined();
  });

  it('R15.5 diagnostic lines never contain the source text or an argument value', async () => {
    const deps = stubs();
    connection = await connect(deps);
    const marker = 'LzSecretMarker42';
    await rawCall(connection.client, 'scan_ast_curses', { source: `var ${marker};`, sourceLanguage: 'es3' });
    await rawCall(connection.client, 'scan_ast_curses', { source: marker, sourceLanguage: marker });
    await rawCall(connection.client, 'extract_function_signatures', { source: marker, sourceLanguage: 'es3', [marker]: 1 });
    expect(deps.log).toHaveBeenCalled();
    for (const [line] of deps.log.mock.calls as [string][]) expect(line).not.toContain(marker);
  });

  it('R15.6 each handled call writes one constant-field diagnostic line', async () => {
    const deps = stubs();
    connection = await connect(deps);
    await rawCall(connection.client, 'scan_ast_curses', { source: 'var a;', sourceLanguage: 'es3' });
    await rawCall(connection.client, 'scan_ast_curses', {});
    expect(deps.log.mock.calls.map(([line]) => (line as string).replace(/durationMs=\d+/, 'durationMs=N'))).toEqual([
      'lazarus-curse-scanner tool=scan_ast_curses result=ok durationMs=N',
      'lazarus-curse-scanner tool=scan_ast_curses result=INVALID_ARGUMENTS durationMs=N',
    ]);
  });
});
