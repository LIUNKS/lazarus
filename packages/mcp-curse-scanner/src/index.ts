import { createRequire } from 'node:module';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server/create-server.js';
import { formatServerEvent, logEvent } from './server/diagnostics.js';
import { installShutdown } from './server/shutdown.js';

// From dist/index.js, ../package.json is the package root file. A JSON import would fall outside
// rootDir, so the version is read at run time.
const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

const server = createServer(version);
const transport = new StdioServerTransport();
transport.onerror = () => logEvent(formatServerEvent('transport-error'));

installShutdown(server, logEvent);
await server.connect(transport);
logEvent(formatServerEvent('started'));
