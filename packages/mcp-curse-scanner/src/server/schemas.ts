import { z } from 'zod';

export const TOOL_NAMES = ['scan_ast_curses', 'extract_function_signatures'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const TOOL_DESCRIPTIONS: Readonly<Record<ToolName, string>> = {
  scan_ast_curses:
    'Scan legacy JavaScript (ES3, ES5, jQuery-era, or old Node.js) with a static AST analyzer and report six kinds of curses with exact 1-based line and column numbers. Findings are static heuristics.',
  extract_function_signatures:
    'List every function in legacy JavaScript with its name, parameters, position, nesting depth, and a static purity hint. The purity hint is a heuristic and not a proof.',
};

// The limit is in characters. The library applies its own limit in UTF-8 bytes.
export const ToolArgs = z.strictObject({
  source: z.string().max(1_048_576),
  sourceLanguage: z.enum(['es3', 'es5-jquery', 'legacy-node']),
});
export type ToolArgs = z.infer<typeof ToolArgs>;
