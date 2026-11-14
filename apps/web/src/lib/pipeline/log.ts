import 'server-only';

// The single safe log-line writer (Requirement 17). A log line holds the route name, an error code, the corpse id,
// the elapsed time, and a short constant. No field can carry source code, a prompt, a model output, an email address,
// or a configuration value, because the line types below have no such field.
import type { ErrorCode } from './errors';

export type PipelineRoute = 'scan' | 'seance' | 'reincarnate';

export type LogLine =
  | {
      event: 'pipeline_error';
      route: PipelineRoute;
      code: ErrorCode;
      /** The corpse id once the request body was accepted, and null before. */
      corpseId: string | null;
      /** Milliseconds from the start of the handler to the response, a non-negative integer. */
      elapsedMs: number;
      /** A short constant: a SQLSTATE, an HTTP status, a rule name, or a fixed word. */
      detail: string;
    }
  | {
      event: 'status_update_failed';
      route: PipelineRoute;
      corpseId: string;
      kind: 'rejected' | 'error';
    };

export function writeLogLine(line: LogLine): void {
  console.error(JSON.stringify(line));
}
