const PREFIX = 'lazarus-curse-scanner';

export type ServerEvent = 'started' | 'stopped' | 'transport-error';

/** Writes one diagnostic line to stderr. Stdout is reserved for protocol messages. */
export function logEvent(line: string): void {
  process.stderr.write(`${line}\n`);
}

export function formatServerEvent(event: ServerEvent): string {
  return `${PREFIX} event=${event}`;
}

/** Only constant fields: the tool name, a result label, and a duration. Never source text. */
export function formatToolEvent(tool: string, result: string, durationMs: number): string {
  return `${PREFIX} tool=${tool} result=${result} durationMs=${durationMs}`;
}
