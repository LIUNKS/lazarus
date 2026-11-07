import fc from 'fast-check';
import { describe, it } from 'vitest';
import { formatToolEvent } from '../../src/server/diagnostics.ts';

const LABELS = ['ok', 'INVALID_INPUT', 'INPUT_TOO_LARGE', 'SYNTAX_ERROR', 'LIMIT_EXCEEDED', 'TIMEOUT', 'INVALID_ARGUMENTS', 'INTERNAL_ERROR'];

describe('diagnostic lines', () => {
  it('R15.5 contain only the constant prefix, the tool name, a result label, and a duration', () => {
    // Feature: 02-scanner-and-verifier, Property 17: Diagnostic lines contain only constant fields
    fc.assert(
      fc.property(
        fc.constantFrom('scan_ast_curses', 'extract_function_signatures'),
        fc.constantFrom(...LABELS),
        fc.nat(),
        (tool, label, duration) => {
          const line = formatToolEvent(tool, label, duration);
          return (
            line === `lazarus-curse-scanner tool=${tool} result=${label} durationMs=${duration}` &&
            /^lazarus-curse-scanner tool=[a-z_]+ result=[A-Za-z_]+ durationMs=\d+$/.test(line) &&
            !line.includes('\n')
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
