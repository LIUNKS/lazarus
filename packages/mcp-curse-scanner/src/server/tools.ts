import { ErrorCode, McpError, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { extractFunctionSignatures, scanCurses } from '../lib.js';
import { formatToolEvent } from './diagnostics.js';
import { TOOL_NAMES, ToolArgs, type ToolName } from './schemas.js';

export interface ServerDeps {
  scan: typeof scanCurses;
  extract: typeof extractFunctionSignatures;
  log: (line: string) => void;
}

const INTERNAL_ERROR_TEXT = 'Internal error while handling the tool call.';
const MAX_NAMES = 20;
const MAX_NAME_LENGTH = 64;

const isToolName = (name: string): name is ToolName => (TOOL_NAMES as readonly string[]).includes(name);

const textResult = (text: string, isError: boolean): CallToolResult =>
  isError ? { isError: true, content: [{ type: 'text', text }] } : { content: [{ type: 'text', text }] };

// Names of the invalid properties: the joined path of each issue, each key of an
// `unrecognized_keys` issue, and `arguments` for an issue without a path (absent `arguments`).
function invalidPropertyNames(error: { issues: readonly { path: readonly PropertyKey[]; code: string; keys?: string[] }[] }): string {
  const names = new Set<string>();
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys' && issue.keys) {
      for (const key of issue.keys) names.add(key.slice(0, MAX_NAME_LENGTH));
    } else {
      const path = issue.path.map(String).join('.');
      names.add((path === '' ? 'arguments' : path).slice(0, MAX_NAME_LENGTH));
    }
  }
  return [...names].sort().slice(0, MAX_NAMES).join(', ');
}

/** Throws only McpError, and only for an unknown tool name. Everything else is a tool result. */
export function callTool(name: string, args: unknown, deps: ServerDeps): CallToolResult {
  if (!isToolName(name)) throw new McpError(ErrorCode.InvalidParams, 'Unknown tool');

  const started = Date.now();
  const finish = (label: string, result: CallToolResult): CallToolResult => {
    deps.log(formatToolEvent(name, label, Math.max(0, Date.now() - started)));
    return result;
  };

  try {
    const parsed = ToolArgs.safeParse(args);
    if (!parsed.success) {
      return finish('INVALID_ARGUMENTS', textResult(`Invalid arguments: ${invalidPropertyNames(parsed.error)}`, true));
    }
    const { source, sourceLanguage } = parsed.data;
    const value = name === 'scan_ast_curses' ? deps.scan(source, sourceLanguage) : deps.extract(source, sourceLanguage);
    return finish(value.ok ? 'ok' : value.code, textResult(JSON.stringify(value), !value.ok));
  } catch {
    // Nothing from the exception or the arguments reaches the result.
    return finish('INTERNAL_ERROR', textResult(INTERNAL_ERROR_TEXT, true));
  }
}
