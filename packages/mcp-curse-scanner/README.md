# @lazarus/mcp-curse-scanner

## Overview

This package is a deterministic static analyzer for legacy JavaScript (ES3, ES5/jQuery, and old Node.js), built on `acorn`. It detects six kinds of curses with exact 1-based line and column numbers, and it lists the functions of a module with a purity hint. It is available as a TypeScript library and as an MCP server over stdio. The scanner treats the analyzed code only as text and never runs it. Its findings are static heuristics that can miss or over-report constructs.

## Build and test

Run these commands from the repository root. The `test` task depends on `build` because the integration tests start `dist/index.js`, so use Turborepo to run them together:

```sh
pnpm install
pnpm exec turbo run build lint test --filter=@lazarus/mcp-curse-scanner
```

The root scripts `pnpm build`, `pnpm lint`, and `pnpm test` also include this package.

## Library usage

Both functions are synchronous and never throw. They return either a success value or a Scan_Error with `ok` set to `false`.

```ts
import { scanCurses } from '@lazarus/mcp-curse-scanner';

const source = 'var total = 0;\nif (total == "0") { counter = 1; }\n';
const result = scanCurses(source, 'es5-jquery');

if (!result.ok) {
  console.error(`${result.code}: ${result.message}`);
} else {
  for (const finding of result.curses) {
    console.log(`${finding.curseType} (${finding.severity}) at ${finding.lineNumber}:${finding.column}`);
  }
}
```

```ts
import { extractFunctionSignatures } from '@lazarus/mcp-curse-scanner';

const source = 'function add(a, b) { return a + b; }\n';
const result = extractFunctionSignatures(source, 'es3');

if (!result.ok) {
  console.error(`${result.code}: ${result.message}`);
} else {
  for (const fn of result.functions) {
    console.log(`${fn.name ?? '<anonymous>'}(${fn.params.join(', ')}) pureCandidate=${fn.pureCandidate}`);
  }
}
```

`pureCandidate` is a static heuristic. It is `true` when the scanner found no impurity marker in the function. It does not prove purity or determinism.

## Detection rules

| Curse_Type | Severity |
| --- | --- |
| `GLOBAL_POLLUTION` | `BLOOD_CURSE` |
| `VAR_HOISTING` | `HEX` |
| `IMPLICIT_COERCION` | `HEX` |
| `CALLBACK_HELL` | `BLOOD_CURSE` |
| `EVAL_INJECTION` | `FATAL` |
| `PROTOTYPE_POLLUTION` | `FATAL` |

What each rule reports:

- `GLOBAL_POLLUTION`: an assignment to a name that is never declared, or to a property of `window` or `global`. Update expressions (`i++`) and `for...in` variables are not reported.
- `VAR_HOISTING`: one finding per `var` declaration statement, at the `var` keyword.
- `IMPLICIT_COERCION`: each `==` or `!=` binary expression.
- `CALLBACK_HELL`: a function expression passed as a call or `new` argument that has at least two callback ancestors.
- `EVAL_INJECTION`: `eval(...)`, `Function(...)`, and `new Function(...)`. Member calls such as `obj.eval(x)` are not reported.
- `PROTOTYPE_POLLUTION`: an assignment to `__proto__`, or to a computed member whose key is not a string or numeric literal.

Source languages:

- `es3`: parsed as ECMAScript 3. The ES3 future reserved words are rejected as identifiers and accepted as property names.
- `es5-jquery`: parsed as an ECMAScript 5 script.
- `legacy-node`: parsed as an ECMAScript 5 script. A hashbang on the first line and `return` outside a function are accepted.

Function signatures carry these impurity markers: `GLOBAL_WRITE`, `OUTER_SCOPE_WRITE`, `NONDETERMINISTIC_API`, `TIMER_API`, `ENVIRONMENT_API`, and `DYNAMIC_CODE`.

## Result and error formats

A success result from `scanCurses` has these fields, in this order:

- `ok`: `true`
- `sourceLanguage`: the language that was passed in
- `lineCount`: number of lines in the source
- `curses`: list of Curse_Finding objects, sorted by `lineNumber`, then `column`, then curse type order

`extractFunctionSignatures` returns the same fields, with `functions` in place of `curses`. Each function has `name`, `kind` (`declaration` or `expression`), `params`, `startLine`, `startColumn`, `endLine`, `nestingDepth`, `pureCandidate`, and `impurityMarkers`.

A Curse_Finding has these fields, in this order:

- `curseType`
- `severity`
- `lineNumber`: 1-based
- `column`: 1-based, in UTF-16 code units
- `description`: fixed text per curse type
- `exorcismStrategy`: fixed text per curse type

A Scan_Error has `ok` set to `false`, a `code`, a `message`, and for syntax errors also `line` and `column`. The codes are:

- `INVALID_INPUT`
- `INPUT_TOO_LARGE`
- `SYNTAX_ERROR`
- `LIMIT_EXCEEDED`
- `TIMEOUT`

When more than one error applies, the code that comes first in the list above wins, unless the time budget runs out earlier.

## Limits

| Limit | Value |
| --- | --- |
| Source size | 1,048,576 bytes of UTF-8 |
| Syntax tree nodes | 200,000 |
| Syntax tree depth | 512 levels |
| Time budget per scan | 5,000 ms |

The same values are exported as `LIMITS` from the package.

## MCP tools

The MCP server is named `lazarus-curse-scanner` and runs over stdio. Both tools take the same input:

```json
{
  "type": "object",
  "properties": {
    "source": { "type": "string", "maxLength": 1048576 },
    "sourceLanguage": { "type": "string", "enum": ["es3", "es5-jquery", "legacy-node"] }
  },
  "required": ["source", "sourceLanguage"],
  "additionalProperties": false
}
```

### `scan_ast_curses`

Scans the source and reports the curses. On success the tool result has one text item that holds the JSON of the success result of `scanCurses`.

### `extract_function_signatures`

Lists the functions of the source. On success the tool result has one text item that holds the JSON of the success result of `extractFunctionSignatures`.

### Errors

- A Scan_Error is returned as a tool result with `isError` set to `true`. Its single text item holds the JSON of the Scan_Error.
- Missing or invalid arguments (a wrong type, a value outside the language enum, or an unknown property) return a tool result with `isError` set to `true`. The text is `Invalid arguments: ` followed by the names of the invalid properties. No scan runs.
- An `arguments` value that is present but is not an object is rejected with the JSON-RPC `InvalidParams` error.
- An unknown tool name returns a protocol error.
- An unexpected exception returns a constant message that contains nothing from the source or the exception.

The server writes only MCP messages to standard output. Diagnostic lines go to standard error and hold only an event name, a tool name, a result label, and a duration.

## Enabling the MCP server in Kiro

The entry `lazarus-curse-scanner` in `.kiro/settings/mcp.json` stays `"disabled": true` until the file `packages/mcp-curse-scanner/dist/index.js` exists. Do not set `"disabled": false` before `pnpm build` has completed successfully.

1. Run `pnpm build`.
2. In `.kiro/settings/mcp.json`, change `"disabled": true` to `"disabled": false` for the server `lazarus-curse-scanner`.
3. Reload the MCP servers in Kiro.
