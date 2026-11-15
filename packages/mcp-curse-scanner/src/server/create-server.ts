import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { extractFunctionSignatures, scanCurses } from '../lib.js';
import { logEvent } from './diagnostics.js';
import { TOOL_DESCRIPTIONS, TOOL_NAMES, ToolArgs } from './schemas.js';
import { callTool, type ServerDeps } from './tools.js';

export const SERVER_NAME = 'lazarus-curse-scanner';

const CallToolRequestLooseSchema = z.looseObject({
  method: z.literal('tools/call'),
  params: z.looseObject({ name: z.string(), arguments: z.unknown().optional() }),
});

/** Builds the server without a transport, so tests can attach an in-memory one. */
export function createServer(version: string, deps: Partial<ServerDeps> = {}): Server {
  const resolved: ServerDeps = { scan: scanCurses, extract: extractFunctionSignatures, log: logEvent, ...deps };
  const server = new Server({ name: SERVER_NAME, version }, { capabilities: { tools: {} } });

  // The published schema comes from the validator, so the two cannot drift.
  const inputSchema = z.toJSONSchema(ToolArgs) as Record<string, unknown>;

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOL_NAMES.map((name) => ({
      name,
      description: TOOL_DESCRIPTIONS[name],
      inputSchema: inputSchema as { type: 'object'; [key: string]: unknown },
    })),
  }));

  // The SDK's own `Server` wrapper re-validates every `tools/call` request and answers
  // InvalidParams (-32602) for a present non-object `arguments`, before this handler runs. The
  // base class would parse with the strict schema first and answer InternalError (-32603), so
  // this looser schema lets the wrapper's check be the one that answers.
  server.setRequestHandler(CallToolRequestLooseSchema, (request) =>
    callTool(request.params.name, request.params.arguments, resolved),
  );

  return server;
}
