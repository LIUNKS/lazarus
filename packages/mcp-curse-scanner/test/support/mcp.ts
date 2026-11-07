import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from '../../src/server/create-server.ts';
import type { ServerDeps } from '../../src/server/tools.ts';

export interface Connection {
  client: Client;
  close(): Promise<void>;
}

/** A client and a server joined by an in-memory transport. */
export async function connect(deps: Partial<ServerDeps> = {}, version = '0.1.0'): Promise<Connection> {
  const server = createServer(version, deps);
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

/** Sends a raw `tools/call`, so `arguments` can be any JSON value (or absent). */
export function rawCall(client: Client, name: string, args?: unknown) {
  const params = args === undefined ? { name } : { name, arguments: args };
  return client.request({ method: 'tools/call', params } as never, CallToolResultSchema);
}

export const textOf = (result: { content: unknown }): string => {
  const [item] = result.content as { type: string; text: string }[];
  return item!.text;
};
