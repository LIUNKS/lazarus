import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { distEntry, workspaceRoot } from './paths.ts';

export interface JsonRpcMessage {
  jsonrpc: string;
  id?: number;
  result?: { isError?: boolean; content?: { type: string; text: string }[]; [key: string]: unknown };
  error?: { code: number; message: string };
  [key: string]: unknown;
}

/** The built server driven with hand-written JSON-RPC, so raw stdout and stderr can be inspected. */
export class RawServer {
  readonly child: ChildProcessWithoutNullStreams;
  readonly lines: string[] = [];
  stderr = '';
  private buffer = '';
  private readonly messages = new Map<number, JsonRpcMessage>();
  private readonly waiters = new Map<number, (message: JsonRpcMessage) => void>();
  private readonly exited: Promise<number | null>;
  private closedAt = 0;

  constructor(options: { env?: Record<string, string>; command?: string; args?: string[] } = {}) {
    this.child = spawn(options.command ?? process.execPath, options.args ?? [distEntry], {
      cwd: workspaceRoot,
      env: options.env ?? { ...getDefaultEnvironment(), NODE_ENV: 'development' },
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    this.child.stderr.on('data', (chunk: string) => (this.stderr += chunk));
    this.exited = new Promise((resolve) => this.child.on('exit', (code) => resolve(code)));
  }

  get stdout(): string {
    return this.lines.join('\n');
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.lines.push(line);
      const message = JSON.parse(line) as JsonRpcMessage;
      if (typeof message.id === 'number') {
        this.messages.set(message.id, message);
        this.waiters.get(message.id)?.(message);
      }
      newline = this.buffer.indexOf('\n');
    }
  }

  send(message: object): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  }

  /** Sends a request and waits for the response with the same id. */
  request(id: number, method: string, params?: object, timeoutMs = 10_000): Promise<JsonRpcMessage> {
    this.send({ id, method, ...(params === undefined ? {} : { params }) });
    return new Promise((resolve, reject) => {
      const found = this.messages.get(id);
      if (found) return resolve(found);
      const timer = setTimeout(() => reject(new Error(`No response for request ${id} (${method})`)), timeoutMs);
      this.waiters.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }

  async initialize(): Promise<JsonRpcMessage> {
    const response = await this.request(1, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'raw-test', version: '0.0.0' },
    });
    this.send({ method: 'notifications/initialized' });
    return response;
  }

  /** Closes stdin and resolves with the exit code and the time the exit took. */
  async closeAndWait(timeoutMs = 5_000): Promise<{ code: number | null; ms: number }> {
    this.closedAt = Date.now();
    this.child.stdin.end();
    const code = await Promise.race([
      this.exited,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs)),
    ]);
    if (code === 'timeout') {
      this.child.kill();
      throw new Error(`The server did not exit within ${timeoutMs} ms after stdin closed.`);
    }
    return { code, ms: Date.now() - this.closedAt };
  }

  kill(): void {
    if (this.child.exitCode === null) this.child.kill();
  }
}
