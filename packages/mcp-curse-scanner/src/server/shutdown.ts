import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { formatServerEvent } from './diagnostics.js';

const FAIL_SAFE_MS = 4_000;

/**
 * StdioServerTransport ignores the end of stdin, so the process handles it here. The normal path
 * does not call process.exit, so pending stdout writes are flushed. A timer ends the process with
 * code 0 if a handle stays open, inside the 5 s of Requirement 14.12.
 */
export function installShutdown(server: Server, log: (line: string) => void): void {
  let stopping = false;

  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    // unref'd: the process ends as soon as the loop drains, and the timer still fires if a handle
    // keeps the loop alive.
    setTimeout(() => process.exit(0), FAIL_SAFE_MS).unref();
    try {
      await server.close();
    } catch {
      // The process is ending anyway.
    }
    log(formatServerEvent('stopped'));
    process.exitCode = 0;
  };

  process.stdin.on('end', () => void shutdown());
  process.stdin.on('close', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
