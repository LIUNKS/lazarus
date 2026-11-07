# Requirements Document

## Introduction

This spec defines one package of the Lazarus pnpm and Turborepo monorepo: **`packages/mcp-curse-scanner`**. It is a deterministic static analyzer for legacy JavaScript built on `acorn`. It detects the six Curse_Types stored in the database, reports exact 1-based line numbers, and extracts function signatures. It is exposed as a TypeScript library API and as an MCP server over stdio built with `@modelcontextprotocol/sdk`. The tools are named `scan_ast_curses` and `extract_function_signatures`.

The directory name `02-scanner-and-verifier` is kept for continuity. The equivalence verifier (`packages/pbt-verifier`) is owned by the separate spec `03-pbt-verifier` and is not part of this spec.

**Prerequisite.** Spec `01-lazarus-foundation` must be implemented first. This spec relies on the root workspace files (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `vitest.shared.ts`), on `.gitignore` ignoring `dist/`, and on the three Sample_Sources under `db/seed/` (`invoice-totals`, `query-string-parser`, and `batch-calculator`), each holding `legacy.js` and `sample.json`. Spec 01 Requirement 18.4 defines the construct for each Curse_Type. This spec adopts those definitions as the normative detection rules, so scanner output and seeded curses agree. Requirement 17 defines how the agreement is tested against the seed files.

**Execution safety.** The scanner never executes, evaluates, imports, or instantiates the code it analyzes. It treats legacy code only as inert text. Execution of legacy code and its isolation belong to `03-pbt-verifier` and to the later spec `07-sandboxed-execution`, so no execution-safety mechanism is needed in this spec. The guarantee that the scanner stays inert is kept in Requirements 3, 15, and 20.

**Out of scope** (separate later specs): `packages/pbt-verifier` (spec `03-pbt-verifier`), `apps/web` and any API Route Handler, any LLM call (Groq or Vercel AI SDK), any database read or write, execution of legacy or user-supplied code, repository import from GitHub, and any change to spec 01 deliverables (migrations, seed, harness, Verification_Suite). Editing `.kiro/settings/mcp.json` is also not a deliverable. The user performs the one-line enablement manually (Requirement 16).

## Glossary

- **Foundation_Spec**: The approved spec `01-lazarus-foundation` and the files it delivers.
- **Workspace_Root**: The repository root directory `lazarus/`.
- **Scanner_Package**: The workspace package in `packages/mcp-curse-scanner`.
- **Curse_Scanner**: The library API exported by the Scanner_Package that analyzes legacy JavaScript source text.
- **MCP_Server**: The Model Context Protocol server over stdio started by `packages/mcp-curse-scanner/dist/index.js`.
- **Root_Pipeline**: The Turborepo task graph started by the root scripts `build`, `test`, and `lint` of the Foundation_Spec.
- **Source_Language**: One of `es3`, `es5-jquery`, or `legacy-node`.
- **Curse_Type**: One of `GLOBAL_POLLUTION`, `VAR_HOISTING`, `IMPLICIT_COERCION`, `CALLBACK_HELL`, `EVAL_INJECTION`, `PROTOTYPE_POLLUTION`, listed in this order as the Curse_Type_Order.
- **Severity**: One of `HEX`, `BLOOD_CURSE`, `FATAL`.
- **Curse_Finding**: One object reported by the Curse_Scanner with the fields `curseType`, `severity`, `lineNumber`, `column`, `description`, and `exorcismStrategy`.
- **Scan_Result**: The value returned by the Curse_Scanner: either a success value with `ok` set to `true` or a Scan_Error value with `ok` set to `false`.
- **Scan_Error**: An error value with the fields `code` and `message`, and for syntax errors also `line` and `column`. The codes are `INVALID_INPUT`, `INPUT_TOO_LARGE`, `SYNTAX_ERROR`, `LIMIT_EXCEEDED`, and `TIMEOUT`.
- **Line_Count**: The number of lines of a source text, where the line terminators are LF, CR, CR LF, U+2028, and U+2029, CR LF counts as one terminator, and a source text without terminators has a Line_Count of 1.
- **Source_Size_Limit**: 1,048,576 bytes of UTF-8.
- **Node_Limit**: 200,000 syntax tree nodes.
- **Depth_Limit**: 512 levels of syntax tree nesting.
- **Scan_Time_Budget**: 5,000 milliseconds of wall-clock time per scan.
- **Stack_Limit_Source**: A source text for which the parser exhausts the call stack, or comes within the parser's stack headroom, so that whether parsing completes can depend on the call stack depth at the time of the call. This is the case for sources whose nesting is near the parser stack limit.
- **ES3_Reserved_Words**: The ECMAScript 3 future reserved words `abstract`, `boolean`, `byte`, `char`, `class`, `const`, `debugger`, `double`, `enum`, `export`, `extends`, `final`, `float`, `goto`, `implements`, `import`, `int`, `interface`, `long`, `native`, `package`, `private`, `protected`, `public`, `short`, `static`, `super`, `synchronized`, `throws`, `transient`, and `volatile`.
- **Function_Signature**: One object returned by `extract_function_signatures` with the fields `name`, `kind`, `params`, `startLine`, `startColumn`, `endLine`, `nestingDepth`, `pureCandidate`, and `impurityMarkers`.
- **Pure_Candidate**: A function for which the Curse_Scanner found no Impurity_Marker. The label is a static heuristic and is not a guarantee of purity.
- **Impurity_Marker**: One of `GLOBAL_WRITE`, `OUTER_SCOPE_WRITE`, `NONDETERMINISTIC_API`, `TIMER_API`, `ENVIRONMENT_API`, `DYNAMIC_CODE`, as defined in Requirement 13.
- **Clean_Corpus**: A set of ES5 programs, produced by a fast-check generator in the Scanner_Package tests, that contain none of the constructs defined in Requirements 4 to 9.
- **Curse_Corpus**: A fixed set of source snippets in the Scanner_Package tests, with an expected finding list for each snippet, covering every positive and negative example named in Requirements 4 to 9.
- **Sample_Source**: A directory directly under `db/seed/` that holds the files `legacy.js` and `sample.json` of one sample corpse of the Foundation_Spec.
- **Entry_Function**: The single deterministic, pure, named top-level function of a sample corpse, whose name is stored in the field `entryFunction` of the `sample.json` of its Sample_Source.
- **Seeded_Curse**: One entry of the `curses` array in the `sample.json` of a Sample_Source, with the fields `type` (a Curse_Type), `severity` (a Severity), and `match` (a text marker).
- **Seeded_Line**: The line number of a Seeded_Curse: the 1-based number of the first line of the `legacy.js` of its Sample_Source that contains `match` as a substring, after every CR LF in `legacy.js` is replaced by LF. This is the rule of `db/seed/generate-seed.ts` and yields the `line_number` stored by `db/migrations/V2__seed_sample_corpses.sql`.
- **Registration**: The entry `lazarus-curse-scanner` in `.kiro/settings/mcp.json`, which runs `node ./packages/mcp-curse-scanner/dist/index.js` and lists `scan_ast_curses` and `extract_function_signatures` in `autoApprove`.
- **Forbidden_Phrases**: The strings `100%`, `mathematical proof`, `mathematically proven`, and `guaranteed`, compared case-insensitively.

## Requirements

### Requirement 1: Package scaffolding and workspace integration

**User Story:** As a developer, I want the scanner package to plug into the existing pnpm and Turborepo workspace, so that `pnpm build`, `pnpm test`, and `pnpm lint` cover it without changes to the root configuration.

#### Acceptance Criteria

1. THE Scanner_Package SHALL provide a `package.json` that is valid JSON, has `name` set to `@lazarus/mcp-curse-scanner`, has `private` set to `true`, and declares `engines.node` as `>=24`.
2. THE Scanner_Package SHALL define the scripts `build`, `test`, and `lint` in its own `package.json`, each with a non-empty command string.
3. WHEN the root script `build` runs, THE Root_Pipeline SHALL run the `build` script of the Scanner_Package and SHALL exit with code 0 if that script exits with code 0.
4. WHEN the root script `test` runs, THE Root_Pipeline SHALL run the `test` script of the Scanner_Package in single-run mode without watch mode, and SHALL exit with code 0 if that script exits with code 0.
5. WHEN the root script `lint` runs, THE Root_Pipeline SHALL run ESLint and `tsc --noEmit` for the Scanner_Package, SHALL exit with a non-zero code if either tool reports one or more errors for the package, and SHALL exit with code 0 if both tools report zero errors for the package.
6. THE Scanner_Package SHALL provide a `tsconfig.json` that extends `../../tsconfig.base.json`, such that the resolved compiler options reported by `tsc --showConfig` contain `"strict": true`.
7. WHEN a TypeScript file in the Scanner_Package, including test files, contains an explicit `any` type annotation, THE lint script of the Scanner_Package SHALL report a `@typescript-eslint/no-explicit-any` violation and exit with a non-zero code.
8. THE Scanner_Package SHALL provide a Vitest configuration that extends the root `vitest.shared.ts`.
9. THE Scanner_Package SHALL declare, under `dependencies` or `devDependencies` in its own `package.json`, every third-party module (any import specifier that is neither a relative path nor a Node.js built-in module) that its source files and test files import, and SHALL declare at least `acorn`, `@modelcontextprotocol/sdk`, `zod`, and `fast-check`.
10. THE Scanner_Package SHALL write all source comments, test descriptions, error messages, and documentation in English.
11. THE Scanner_Package SHALL NOT modify `pnpm-workspace.yaml`, the root `turbo.json`, the root `package.json` scripts, or any other file delivered by the Foundation_Spec, with a package-level Turborepo configuration file inside the package directory as the only mechanism for package-specific task settings.
12. IF the `build` script of the Scanner_Package exits with a non-zero code during the root script `build`, THEN THE Root_Pipeline SHALL exit with a non-zero code and SHALL report that the `build` script of the Scanner_Package failed.
13. IF the `test` script of the Scanner_Package exits with a non-zero code during the root script `test`, THEN THE Root_Pipeline SHALL exit with a non-zero code and SHALL report that the `test` script of the Scanner_Package failed.

### Requirement 2: Build output, entry points, and module format

**User Story:** As a developer, I want predictable build outputs, so that the MCP Registration works and other packages can import the library without side effects.

#### Acceptance Criteria

1. WHEN the `build` script of the Scanner_Package completes with exit code 0, THE Scanner_Package SHALL have produced the file `packages/mcp-curse-scanner/dist/index.js`.
2. WHEN `node packages/mcp-curse-scanner/dist/index.js` runs with stdio connected to an MCP client, THE MCP_Server SHALL answer an MCP `initialize` request with a valid MCP `initialize` response within 5000 ms, SHALL remain running until stdin closes or the process receives a termination signal, and SHALL write only MCP protocol messages to standard output.
3. THE Scanner_Package SHALL declare in the `exports` field of its `package.json` the subpath `.` with a `types` condition and an import/require condition, and WHEN the build completes with exit code 0, every file path referenced by those conditions SHALL exist.
4. WHEN the `.` entry of the Scanner_Package is imported by Node.js 24, THE Scanner_Package SHALL expose the Curse_Scanner library API, SHALL NOT start a server, SHALL write 0 bytes to standard output, and SHALL write 0 bytes to standard error.
5. WHEN the `build` script of the Scanner_Package completes with exit code 0, THE Scanner_Package SHALL have emitted a `dist/` directory in which no import specifier resolves to a path outside the package directory, and no file in `dist/` references `db/`, `scripts/`, or `.kiro/` at the Workspace_Root.
6. THE `.gitignore` of the Foundation_Spec SHALL cause `git check-ignore` to exit with code 0 and report `packages/mcp-curse-scanner/dist` as ignored, and THE Scanner_Package SHALL NOT require any change to `.gitignore`.
7. THE Scanner_Package SHALL use a single module format (ESM or CJS), selected in the design, for every `.js` file in `dist/`, and SHALL declare that format consistently in `package.json`: `type` is `module` for ESM or `commonjs`/absent for CJS, and the `exports` and `main` targets point to files in that format.
8. WHEN `node dist/index.js` of the Scanner_Package is executed by Node.js 24 with the process working directory set to the Workspace_Root, THE MCP_Server SHALL start without a module resolution error (no `ERR_MODULE_NOT_FOUND` or `MODULE_NOT_FOUND` on standard error) and SHALL still be running 2000 ms after launch.
9. WHEN the MCP_Server stdin is closed by the client, THE MCP_Server SHALL exit with code 0 within 5000 ms.

### Requirement 3: Scanner library API and input handling

**User Story:** As a developer of later packages, I want one typed function that scans legacy source text, so that the web app and the MCP server share the same analysis.

#### Acceptance Criteria

1. THE Curse_Scanner SHALL export a function `scanCurses(source, sourceLanguage)` that accepts a string and a Source_Language and returns a Scan_Result as a plain value, not a Promise, before the call returns.
2. THE Curse_Scanner SHALL export a function `extractFunctionSignatures(source, sourceLanguage)` that applies the same input validation, parsing rules, and Scan_Error codes as `scanCurses` and, on success, returns an object containing `ok` set to `true`, `sourceLanguage`, `lineCount` equal to the Line_Count of the source, and `functions`, which is a list of Function_Signature objects.
3. WHEN `scanCurses` succeeds, THE Curse_Scanner SHALL return an object containing `ok` set to `true`, `sourceLanguage` equal to the argument passed, `lineCount` equal to the Line_Count of the source, and `curses`, which is a list of Curse_Finding objects.
4. WHERE the Source_Language is `es3`, THE Curse_Scanner SHALL parse the source as an ECMAScript 3 script.
5. WHERE the Source_Language is `es5-jquery`, THE Curse_Scanner SHALL parse the source as an ECMAScript 5 script.
6. WHERE the Source_Language is `legacy-node`, THE Curse_Scanner SHALL parse the source as an ECMAScript 5 script, SHALL accept a hashbang line only as the first line of the source, and SHALL accept a `return` statement outside a function.
7. IF the Source_Language argument is not exactly (case-sensitive) one of `es3`, `es5-jquery`, or `legacy-node`, THEN THE Curse_Scanner SHALL return a Scan_Error with the code `INVALID_INPUT`, SHALL NOT parse the source, and SHALL NOT throw an exception.
8. IF the source argument is not a string, THEN THE Curse_Scanner SHALL return a Scan_Error with the code `INVALID_INPUT`, SHALL NOT parse the source, and SHALL NOT throw an exception.
9. WHEN the source is an empty string or contains only whitespace and comments, THE Curse_Scanner SHALL return a success value with `ok` set to `true`, an empty `curses` list, and `lineCount` equal to the Line_Count of the source.
10. THE Curse_Scanner SHALL NOT execute, evaluate, import, or instantiate any part of the scanned source, including with `eval`, `new Function`, `node:vm`, or `child_process`.
11. IF the source contains ECMAScript 2015 or later syntax (including `let`, `const`, arrow functions, template literals, classes, and modules), THEN THE Curse_Scanner SHALL return a Scan_Error with the code `SYNTAX_ERROR`, SHALL NOT throw an exception, and SHALL return no `curses` or `functions` list.
12. IF the source does not conform to the grammar of its Source_Language, including a hashbang line that is not the first line or is present when the Source_Language is not `legacy-node`, and including a `return` statement outside a function when the Source_Language is not `legacy-node`, THEN THE Curse_Scanner SHALL return a Scan_Error with the code `SYNTAX_ERROR` that includes the 1-based line number and 1-based column number of the first offending token, and SHALL NOT throw an exception.
13. WHERE the Source_Language is `es3`, THE Curse_Scanner SHALL reject an ES3_Reserved_Word used as an identifier (a variable name, a function name, or a parameter name) with a Scan_Error with the code `SYNTAX_ERROR` that includes the 1-based line and column of that identifier, and SHALL accept an ES3_Reserved_Word used as a property name, because every engine still runs such code. The Scanner_Package tests SHALL contain one test for each of the following examples. Rejected: `var class = 1;`, `var int;`, `function enum() {}`, and `function f(class) {}`. Accepted: `a.class = 1;`, `var o = {class: 1};`, and `var v = o.int;`.

### Requirement 4: Detection of GLOBAL_POLLUTION

**User Story:** As a developer, I want assignments to undeclared variables and to `window` or `global` properties reported, so that mutable global state in legacy code becomes visible.

#### Acceptance Criteria

1. WHEN the source contains an assignment expression, with any ECMAScript 5 assignment operator (`=`, `+=`, `-=`, `*=`, `/=`, `%=`, `<<=`, `>>=`, `>>>=`, `&=`, `|=`, `^=`), whose target is an identifier that has no declaration in the enclosing function scopes up to and including the program scope, THE Curse_Scanner SHALL report one Curse_Finding of type `GLOBAL_POLLUTION` per such assignment expression, at the start line and start column of that assignment expression.
2. THE Curse_Scanner SHALL treat the following as declarations for criterion 1: a `var` declarator, a function declaration name, a function parameter, the name of a named function expression inside that function, the identifier `arguments` inside a function, and a `catch` clause parameter inside its `catch` block. A declaration located anywhere in a function scope, including after the assignment, SHALL count for the whole function scope, and a declaration in an enclosing function scope or the program scope SHALL count for all functions nested inside it.
3. WHEN the source contains an assignment expression whose target is a member expression whose object is directly the identifier `window` or `global`, with a non-computed property or a computed property, THE Curse_Scanner SHALL report one Curse_Finding of type `GLOBAL_POLLUTION` at the start line and start column of that assignment expression, regardless of whether a local declaration named `window` or `global` exists.
4. THE Curse_Scanner SHALL report `GLOBAL_POLLUTION` for the following examples: `counter = 0;` with no declaration of `counter`, `total += 1;` with no declaration of `total`, `window.cache = {};`, `global.helper = fn;`, `window['x'] = 1;`, and `a = b = 0;` with no declaration of `a` or `b` (two findings, one at the start of each assignment expression).
5. THE Curse_Scanner SHALL report no `GLOBAL_POLLUTION` finding for the following examples: `var counter = 0;`, an assignment to a parameter of the enclosing function, an assignment to a variable declared with `var` later in the same function, an assignment to a variable declared with `var` in an enclosing function, `obj.name = 'x';`, `this.value = 1;`, `module.exports = fn;`, `window.a.b = 1;` (the object of the target is not directly `window`), and an assignment to a `catch` parameter inside its `catch` block.
6. THE Curse_Scanner SHALL report no `GLOBAL_POLLUTION` finding for an update expression (`i++`) or for the loop variable of a `for...in` statement, because the detection rule in Requirement 18.4 of the Foundation_Spec names assignments only.

### Requirement 5: Detection of VAR_HOISTING

**User Story:** As a developer, I want every `var` declaration reported, so that function-scoped hoisting behavior in legacy code is visible.

#### Acceptance Criteria

1. WHEN the source contains a `var` declaration statement at any nesting depth, including the initializer of a `for` or `for...in` statement, THE Curse_Scanner SHALL report one Curse_Finding of type `VAR_HOISTING` whose position is the 1-based line and 1-based column of the first character of the `var` keyword.
2. WHEN one `var` declaration statement declares several variables, THE Curse_Scanner SHALL report exactly one `VAR_HOISTING` finding for that statement, positioned at its `var` keyword.
3. WHEN the source contains several `var` declaration statements, THE Curse_Scanner SHALL report exactly one `VAR_HOISTING` finding per statement, ordered by ascending line and then ascending column.
4. WHEN the source is one of `var a = 1;`, `var a, b = 2;`, or `for (var i = 0; i < n; i++) {}`, THE Curse_Scanner SHALL report exactly one `VAR_HOISTING` finding for that source.
5. IF the word `var` occurs only inside a string literal, a regular expression literal, or a comment, as part of an identifier such as `variable` or `vars`, or as part of a function declaration or function parameter, THEN THE Curse_Scanner SHALL report zero `VAR_HOISTING` findings for that occurrence.
6. IF the source is empty or contains no `var` declaration statement, THEN THE Curse_Scanner SHALL report zero `VAR_HOISTING` findings and SHALL complete without an error.

### Requirement 6: Detection of IMPLICIT_COERCION

**User Story:** As a developer, I want loose equality operators reported, so that implicit type coercion in comparisons is visible.

#### Acceptance Criteria

1. WHEN the source contains a binary expression with the operator `==` or `!=`, THE Curse_Scanner SHALL report one Curse_Finding of type `IMPLICIT_COERCION` with `lineNumber` set to the 1-based start line and `column` set to the 1-based start column of that binary expression, at any nesting depth, including inside function bodies, call arguments, and conditions.
2. THE Curse_Scanner SHALL report `IMPLICIT_COERCION` for the following examples: `a == b` as the entire source (line 1, column 1), `a != b` as the entire source (line 1, column 1), and `if (x == null) {}` as the entire source (line 1, column 5).
3. THE Curse_Scanner SHALL report no `IMPLICIT_COERCION` finding for the operators `===`, `!==`, `<=`, `>=`, or `=`, or for the text `==` or `!=` inside a string literal, a regular expression literal, or a comment.
4. WHEN a binary expression with the operator `==` or `!=` spans several lines, THE Curse_Scanner SHALL report the finding at the line and column on which the binary expression starts, regardless of the line on which the operator appears. For the source `a\n== b`, the finding is at line 1, column 1.
5. WHEN a binary expression with the operator `==` or `!=` contains another binary expression with the operator `==` or `!=` as an operand, THE Curse_Scanner SHALL report one separate Curse_Finding for each of the binary expressions. For the source `a == b != c`, the Curse_Scanner reports 2 findings, both at line 1, column 1.

### Requirement 7: Detection of CALLBACK_HELL

**User Story:** As a developer, I want deeply nested callbacks reported, so that callback pyramids in legacy code are visible.

#### Acceptance Criteria

1. WHEN the Curse_Scanner scans a function expression that is a direct argument of a call expression or a `new` expression (a "callback") and that callback has at least 2 ancestor callbacks, THE Curse_Scanner SHALL report exactly one Curse_Finding of type `CALLBACK_HELL` for that callback, at the start line and start column of that callback's `function` keyword.
2. WHEN the Curse_Scanner scans a chain of 4 callbacks, each nested directly or indirectly inside the previous one (the third-level callback has 2 ancestor callbacks and the fourth-level callback has 3), THE Curse_Scanner SHALL report exactly 2 `CALLBACK_HELL` findings, one for the third-level callback and one for the fourth-level callback, and none for the first-level and second-level callbacks.
3. WHEN the Curse_Scanner scans the source `a(function () { b(function () { c(function () { d(); }); }); });` written on one line, THE Curse_Scanner SHALL report exactly one `CALLBACK_HELL` finding, located at the start line and start column of the `function` keyword passed to `c`.
4. IF a function expression has fewer than 2 ancestor callbacks, THEN THE Curse_Scanner SHALL report no `CALLBACK_HELL` finding for it.
5. IF a function is a function declaration, a function expression assigned to a variable, or a function expression that is the callee of a call expression (an immediately invoked function expression) and not a call argument, THEN THE Curse_Scanner SHALL report no `CALLBACK_HELL` finding for it and SHALL NOT count it as an ancestor callback toward the threshold of 2.
6. WHEN a function that is not a callback lies between two callbacks in the nesting chain, THE Curse_Scanner SHALL count only ancestors that are callbacks toward the threshold of 2, and the intermediate function SHALL NOT reset or interrupt the count.

### Requirement 8: Detection of EVAL_INJECTION

**User Story:** As a developer, I want dynamic code evaluation reported, so that the most dangerous constructs in legacy code are visible.

#### Acceptance Criteria

1. WHEN the source contains a call expression whose callee is the identifier `eval`, including a callee in parentheses such as `(eval)(x)`, THE Curse_Scanner SHALL report one Curse_Finding of type `EVAL_INJECTION` with `lineNumber` and `column` set to the 1-based start line and start column of that call expression.
2. WHEN the source contains a `new` expression whose callee is the identifier `Function`, with or without an argument list, THE Curse_Scanner SHALL report one Curse_Finding of type `EVAL_INJECTION` with `lineNumber` and `column` set to the 1-based start line and start column of that `new` expression.
3. WHEN the source contains a call expression whose callee is the identifier `Function`, THE Curse_Scanner SHALL report one Curse_Finding of type `EVAL_INJECTION` with `lineNumber` and `column` set to the 1-based start line and start column of that call expression.
4. WHEN the source contains several expressions matching criteria 1 to 3, including expressions nested inside the arguments of another matching expression, THE Curse_Scanner SHALL report exactly one `EVAL_INJECTION` finding for each matching expression and SHALL report no other `EVAL_INJECTION` finding for it. For example, `eval(eval(x))` yields two findings, and `Function('return this')()` yields one finding.
5. THE Curse_Scanner SHALL report `EVAL_INJECTION` for the following examples: `eval(code)`, `new Function('a', 'return a')`, `new Function`, and `Function('return this')()`. This applies even when a local declaration named `eval` or `Function` exists.
6. THE Curse_Scanner SHALL report no `EVAL_INJECTION` finding for the identifiers `evaluate` or `evalResult`, for a member call such as `obj.eval(x)` or `window.eval(x)`, for a `new` expression or call expression whose callee is a member expression such as `new obj.Function('a')`, for a reference to `Function` that is not the callee of a call or `new` expression such as `Function.prototype.call` or `x instanceof Function`, or for the text `eval(` or `Function(` inside a string literal, a regular expression literal, or a comment.

### Requirement 9: Detection of PROTOTYPE_POLLUTION

**User Story:** As a developer, I want writes through `__proto__` or computed keys reported, so that prototype pollution risks in legacy code are visible.

#### Acceptance Criteria

1. WHEN the source contains an assignment expression that uses any ECMAScript 5 assignment operator (`=`, or a compound operator such as `+=` or `|=`) and whose target is the member `__proto__`, written as `obj.__proto__`, `obj['__proto__']`, or `obj["__proto__"]`, THE Curse_Scanner SHALL report exactly one Curse_Finding of type `PROTOTYPE_POLLUTION` for each such assignment expression, at the start line and start column of that assignment expression.
2. WHEN the source contains an assignment expression that uses any ECMAScript 5 assignment operator (`=`, or a compound operator such as `+=` or `|=`) and whose target is a computed member expression whose property is any expression other than a string literal or a numeric literal, THE Curse_Scanner SHALL report exactly one Curse_Finding of type `PROTOTYPE_POLLUTION` for each such assignment expression, at the start line and start column of that assignment expression.
3. WHEN the source contains chained assignment expressions that each match criterion 1 or 2, such as `a[k1] = b[k2] = v;`, THE Curse_Scanner SHALL report one Curse_Finding of type `PROTOTYPE_POLLUTION` per matching assignment expression, each at the start line and start column of its own assignment expression.
4. THE Curse_Scanner SHALL report exactly one `PROTOTYPE_POLLUTION` finding for each of the following examples: `obj.__proto__ = p;`, `obj['__proto__'] = p;`, `target[key] = value;`, and `target[a + b] = value;`.
5. THE Curse_Scanner SHALL report zero `PROTOTYPE_POLLUTION` findings for each of the following examples: `obj.name = v;`, `obj['name'] = v;`, `list[0] = v;`, a read access such as `x = target[key];`, a read access of the prototype such as `x = obj.__proto__;`, and an update expression such as `target[key]++`.

### Requirement 10: Severity, description, and exorcism strategy mapping

**User Story:** As a developer, I want every finding to carry a fixed severity and fixed texts, so that scanner output can be stored in the `curses` table without further processing.

#### Acceptance Criteria

1. THE Curse_Scanner SHALL assign to every Curse_Finding the Severity `FATAL` when its `curseType` is `EVAL_INJECTION` or `PROTOTYPE_POLLUTION`, the Severity `BLOOD_CURSE` when its `curseType` is `GLOBAL_POLLUTION` or `CALLBACK_HELL`, and the Severity `HEX` when its `curseType` is `VAR_HOISTING` or `IMPLICIT_COERCION`, independent of the Source_Language, the position of the finding, and the other findings of the same scan.
2. THE Curse_Scanner SHALL set the `description` of every Curse_Finding to a string that is byte-identical for every finding with the same `curseType` across all scans, consists only of printable ASCII characters (U+0020 to U+007E) forming English text, and has a length of 10 to 500 characters after trimming leading and trailing whitespace.
3. THE Curse_Scanner SHALL set the `exorcismStrategy` of every Curse_Finding to a string that is byte-identical for every finding with the same `curseType` across all scans, consists only of printable ASCII characters (U+0020 to U+007E) forming English text, and has a length of 10 to 500 characters after trimming leading and trailing whitespace.
4. THE Curse_Scanner SHALL use six pairwise different `description` texts and six pairwise different `exorcismStrategy` texts, one of each per Curse_Type, and no `description` text SHALL equal any `exorcismStrategy` text.
5. THE Curse_Scanner SHALL NOT interpolate any identifier name, string literal value, comment text, or source line of the scanned source into the `description` or the `exorcismStrategy` of a Curse_Finding.
6. THE Curse_Scanner SHALL NOT include any of the Forbidden_Phrases in the `description` or the `exorcismStrategy` of a Curse_Finding.
7. THE Curse_Scanner SHALL produce Curse_Finding objects whose `curseType` is one of the six Curse_Types, whose `severity` is one of the three Severity values, whose `lineNumber` is an integer from 1 to the Line_Count of the scanned source, and whose `column` is an integer of at least 1, so that every finding satisfies the CHECK constraints and the column types of the `curses` table of the Foundation_Spec.

### Requirement 11: Determinism and ordering

**User Story:** As a developer, I want byte-identical output for identical input, so that results can be cached, diffed, and compared in tests.

#### Acceptance Criteria

1. WHEN the Curse_Scanner scans the same source text and the same Source_Language twice with `scanCurses` or twice with `extractFunctionSignatures`, THE Curse_Scanner SHALL return values whose JSON serialization is byte-identical, including when the returned value is a Scan_Error with a code other than `TIMEOUT`, except that this guarantee does not apply to a Stack_Limit_Source, for which only Requirement 12 criterion 3 applies (each call returns either a success value or a Scan_Error with the code `LIMIT_EXCEEDED`, and never throws).
2. THE Curse_Scanner SHALL sort the `curses` list by `lineNumber` ascending, then by `column` ascending, then by the position of `curseType` in the Curse_Type_Order, and SHALL return an empty list when no curse is found.
3. THE Curse_Scanner SHALL report at most one Curse_Finding for each combination of `curseType`, `lineNumber`, and `column`.
4. THE Curse_Scanner SHALL sort the `functions` list of `extractFunctionSignatures` by `startLine` ascending, then by `startColumn` ascending, and SHALL return an empty list when the source contains no function.
5. THE Curse_Scanner SHALL serialize every result object with its properties in a fixed order, so that the JSON text does not depend on the order in which the analysis visited the syntax tree. The order SHALL be `ok`, `sourceLanguage`, `lineCount`, then `curses` or `functions` for a success value. The order SHALL be `curseType`, `severity`, `lineNumber`, `column`, `description`, `exorcismStrategy` for a Curse_Finding. The order SHALL be `name`, `kind`, `params`, `startLine`, `startColumn`, `endLine`, `nestingDepth`, `pureCandidate`, `impurityMarkers` for a Function_Signature. The order SHALL be `ok`, `code`, `message`, then `line` and `column` when present for a Scan_Error.
6. THE Curse_Scanner SHALL NOT include timestamps, random values, process identifiers, absolute or relative file paths, host names, user names, or other values that differ between runs in any result. The JSON serialization of a result for a given source text and Source_Language, other than a Stack_Limit_Source and other than a `TIMEOUT` result, SHALL be byte-identical across separate processes, operating systems, working directories, locales, and time zones.
7. THE Curse_Scanner SHALL report every `lineNumber` of a Curse_Finding and every `startLine` and `endLine` of a Function_Signature as an integer from 1 to the Line_Count of the source, and SHALL report every `column` and `startColumn` as an integer greater than or equal to 1.
8. WHEN N LF characters are prepended to a source text, where N is an integer from 1 to the number that keeps the UTF-8 size of the source within the Source_Size_Limit, THE Curse_Scanner SHALL return the same list of Curse_Finding objects with each `lineNumber` increased by N and every other field unchanged, and SHALL return a `lineCount` increased by N.
9. WHEN every LF in a source text that contains no CR is replaced by CR LF, THE Curse_Scanner SHALL return a `curses` list, and a `functions` list for `extractFunctionSignatures`, with the same number of entries and identical values in every field, including `lineNumber`, `column`, `startLine`, `startColumn`, `endLine`, and `lineCount`.

### Requirement 12: Parser errors and resource limits

**User Story:** As a developer, I want clear structured errors for bad input, so that the MCP server and the web app never crash or return partial results.

#### Acceptance Criteria

1. IF the source text contains a syntax error for the selected Source_Language, THEN THE Curse_Scanner SHALL return a Scan_Error with the code `SYNTAX_ERROR`, a `message` containing the parser message truncated to at most 500 characters, and the 1-based integer `line` (from 1 to the Line_Count) and 1-based integer `column` of the first syntax error, and SHALL return no `curses` or `functions` list.
2. IF the UTF-8 encoding of the source text is more than 1,048,576 bytes (the Source_Size_Limit), counting each lone surrogate as the 3 bytes of U+FFFD, THEN THE Curse_Scanner SHALL return a Scan_Error with the code `INPUT_TOO_LARGE` without parsing the source. A source of exactly 1,048,576 bytes SHALL NOT produce this error.
3. IF the syntax tree of the source has more than 200,000 nodes (the Node_Limit) or more than 512 levels of nesting (the Depth_Limit), or the parser exhausts the call stack, THEN THE Curse_Scanner SHALL return a Scan_Error with the code `LIMIT_EXCEEDED` and SHALL return no `curses` or `functions` list. A syntax tree with exactly 200,000 nodes or exactly 512 levels SHALL NOT produce this error when the parser completes. Exhausting the call stack while parsing SHALL produce `LIMIT_EXCEEDED` even when the nesting of the source is below the Depth_Limit. For a source whose nesting is near the parser stack limit, THE Curse_Scanner SHALL return either a success value or a Scan_Error with the code `LIMIT_EXCEEDED`, and SHALL NOT throw an exception. THE Curse_Scanner SHALL enforce the Depth_Limit and the Node_Limit in the visitor that walks the syntax tree, independent of how the tree was produced, so that a syntax tree with more than 512 levels yields `LIMIT_EXCEEDED` also when the installed parser cannot parse a source text of exactly 512 levels to completion on the supported Node.js version.
4. IF a scan runs longer than 5,000 milliseconds of wall-clock time (the Scan_Time_Budget), THEN THE Curse_Scanner SHALL stop the analysis, SHALL return a Scan_Error with the code `TIMEOUT` within 500 milliseconds after the budget elapses, and SHALL return no `curses` or `functions` list.
5. THE Curse_Scanner SHALL NOT throw an exception to the caller for any string input of any content, including random Unicode text, lone surrogates, NUL characters, and text that is not JavaScript, and SHALL return either a success value or a Scan_Error with one of the five defined codes.
6. THE Curse_Scanner SHALL NOT include any excerpt of the scanned source text in the `message` of a Scan_Error, other than the parser's own message text, and SHALL limit the `message` to at most 500 characters.
7. WHEN a Scan_Error is returned, THE Curse_Scanner SHALL set `ok` to `false` and SHALL NOT include a `curses` or `functions` field in the returned value.
8. WHEN a Scan_Error with a code other than `TIMEOUT` is returned for a source that is not a Stack_Limit_Source, THE Curse_Scanner SHALL return, for every repeated call with the same source and Source_Language, a Scan_Error whose JSON serialization is byte-identical to the first. For a Stack_Limit_Source, THE Curse_Scanner SHALL give only the guarantee of criterion 3 (either a success value or a Scan_Error with the code `LIMIT_EXCEEDED`, and no exception), and the byte-identical guarantee of this criterion and of Requirement 11 criterion 1 does not apply.
9. IF more than one error condition applies to the same input, THEN THE Curse_Scanner SHALL return the Scan_Error whose code comes first in this order: `INVALID_INPUT`, `INPUT_TOO_LARGE`, `SYNTAX_ERROR`, `LIMIT_EXCEEDED`, unless the Scan_Time_Budget elapses before the scan reaches that decision, in which case THE Curse_Scanner SHALL return `TIMEOUT`.

### Requirement 13: Function signature extraction

**User Story:** As the author of the Séance stage, I want the functions of a legacy module listed with parameters, positions, and a purity hint, so that the Entry_Function and its helpers can be identified without running the code.

#### Acceptance Criteria

1. WHEN `extractFunctionSignatures` succeeds, THE Curse_Scanner SHALL return one Function_Signature for every function declaration and every function expression in the source, including nested functions and anonymous callbacks.
2. THE Curse_Scanner SHALL set `kind` of a Function_Signature to `declaration` for a function declaration and to `expression` for a function expression.
3. THE Curse_Scanner SHALL set `name` of a Function_Signature to the identifier of a function declaration or of a named function expression, to the identifier on the left side of `var name = function () {}` or `name = function () {}` for an anonymous function expression, and to `null` in every other case, including an anonymous function expression assigned to a member such as `obj.name = function () {}` and an anonymous function expression passed as an argument.
4. THE Curse_Scanner SHALL set `params` of a Function_Signature to the parameter names in declaration order, and to an empty list for a function without parameters.
5. THE Curse_Scanner SHALL set `startLine` and `startColumn` of a Function_Signature to the 1-based line and column of the first character of the `function` keyword, using the same column definition as the `column` field of a Curse_Finding, and SHALL set `endLine` to the 1-based line of the closing brace of the function body, with `endLine` greater than or equal to `startLine`.
6. THE Curse_Scanner SHALL set `nestingDepth` to 0 for a function that has no enclosing function and to the number of enclosing functions otherwise.
7. WHEN the body of a function, including its nested functions, contains an assignment (`=`, a compound assignment operator, `++`, or `--`) to an identifier that has no declaration in the program, or to a member of `window` or `global`, THE Curse_Scanner SHALL include the Impurity_Marker `GLOBAL_WRITE` in `impurityMarkers` of that function.
8. WHEN the body of a function, including its nested functions, contains an assignment (`=`, a compound assignment operator, `++`, or `--`) to an identifier that is declared in the program outside that function, THE Curse_Scanner SHALL include the Impurity_Marker `OUTER_SCOPE_WRITE` in `impurityMarkers` of that function, and SHALL NOT include it for an assignment to a parameter or a variable declared inside that function.
9. WHEN the body of a function, including its nested functions, references an identifier `Date` that has no declaration in the program or the member `Math.random`, THE Curse_Scanner SHALL include the Impurity_Marker `NONDETERMINISTIC_API` in `impurityMarkers` of that function, and SHALL NOT treat a property named `Date` or `random` of any other object as a reference.
10. WHEN the body of a function, including its nested functions, references an identifier `setTimeout`, `setInterval`, or `setImmediate` that has no declaration in the program, THE Curse_Scanner SHALL include the Impurity_Marker `TIMER_API` in `impurityMarkers` of that function.
11. WHEN the body of a function, including its nested functions, references an identifier that has no declaration in the program and is named `window`, `document`, `global`, `$`, `jQuery`, `XMLHttpRequest`, `navigator`, `localStorage`, `sessionStorage`, `require`, `process`, `console`, or `module`, THE Curse_Scanner SHALL include the Impurity_Marker `ENVIRONMENT_API` in `impurityMarkers` of that function.
12. WHEN the body of a function, including its nested functions, contains a finding of type `EVAL_INJECTION`, THE Curse_Scanner SHALL include the Impurity_Marker `DYNAMIC_CODE` in `impurityMarkers` of that function.
13. THE Curse_Scanner SHALL sort `impurityMarkers` in the order `GLOBAL_WRITE`, `OUTER_SCOPE_WRITE`, `NONDETERMINISTIC_API`, `TIMER_API`, `ENVIRONMENT_API`, `DYNAMIC_CODE`, and SHALL list each marker at most once.
14. THE Curse_Scanner SHALL document in its README that `pureCandidate` is a static heuristic that does not prove purity or determinism.
15. THE Curse_Scanner SHALL return the same error values as `scanCurses` for the same invalid inputs, as defined in Requirements 3 and 12.
16. THE Curse_Scanner SHALL set `pureCandidate` of a Function_Signature to `true` if and only if `impurityMarkers` of that Function_Signature is an empty list.
17. WHEN `extractFunctionSignatures` succeeds, THE Curse_Scanner SHALL return the Function_Signature objects ordered by ascending `startLine` and, for equal `startLine`, by ascending `startColumn`.
18. WHEN `extractFunctionSignatures` succeeds for a source that contains no function declaration and no function expression, THE Curse_Scanner SHALL return an empty list of Function_Signature objects and SHALL NOT return an error.

### Requirement 14: MCP server protocol and tool schemas

**User Story:** As a Kiro user, I want an MCP server with two well-defined tools, so that the agent can scan legacy code and list its functions.

#### Acceptance Criteria

1. THE MCP_Server SHALL be built with `@modelcontextprotocol/sdk` and SHALL use the stdio transport.
2. WHEN a client requests the tool list, THE MCP_Server SHALL return exactly two tools named `scan_ast_curses` and `extract_function_signatures`, each with a description of 1 to 500 characters written in English and an input schema.
3. THE input schema of each tool SHALL be an object schema with the required property `source` of type string (maximum 1,048,576 characters) and the required property `sourceLanguage` of type string restricted to the values `es3`, `es5-jquery`, and `legacy-node`, and SHALL reject all other properties.
4. THE MCP_Server SHALL validate the arguments of every tool call with a `zod` schema before the arguments reach the Curse_Scanner.
5. WHEN a client calls `scan_ast_curses` with valid arguments and the Curse_Scanner returns a success value, THE MCP_Server SHALL return a tool result without the `isError` flag whose content is exactly one text item containing the JSON serialization of that success value.
6. WHEN a client calls `extract_function_signatures` with valid arguments and the Curse_Scanner returns a success value, THE MCP_Server SHALL return a tool result without the `isError` flag whose content is exactly one text item containing the JSON serialization of that success value.
7. WHEN the Curse_Scanner returns a Scan_Error, THE MCP_Server SHALL return a tool result with `isError` set to `true` whose content is exactly one text item containing the JSON serialization of the Scan_Error.
8. IF `arguments` of a tool call is absent or is an object that fails the `zod` schema (a missing property, a property of the wrong type, a value outside the `sourceLanguage` enum, or an undeclared property), THEN THE MCP_Server SHALL return a tool result with `isError` set to `true` whose text content names each invalid property, SHALL NOT call the Curse_Scanner, and SHALL remain running. IF `arguments` of a tool call is present and is not an object, THEN THE MCP_Server SHALL answer the request with a JSON-RPC `InvalidParams` protocol error, which the `@modelcontextprotocol/sdk` raises before the tool handler runs, SHALL perform no scan, and SHALL remain running and able to handle the next request.
9. IF a client calls a tool name other than `scan_ast_curses` or `extract_function_signatures`, THEN THE MCP_Server SHALL return a protocol error indicating an unknown tool, SHALL NOT call the Curse_Scanner, and SHALL remain running and able to handle the next request.
10. IF an unexpected exception occurs while handling a tool call, THEN THE MCP_Server SHALL return a tool result with `isError` set to `true` whose text content is a constant English message of 1 to 200 characters that is identical for every such exception and contains no part of the `source` argument or of the exception, and SHALL remain running and able to handle the next request.
11. THE tool results of `scan_ast_curses` and `extract_function_signatures` SHALL parse as JSON that is deeply equal to the value returned by the corresponding library function for the same arguments.
12. WHEN the standard input of the MCP_Server process closes, THE MCP_Server SHALL exit with code 0 within 5,000 milliseconds.
13. THE MCP_Server implementation SHALL register tools and handle validation failures using only the APIs and behaviors documented for the installed `@modelcontextprotocol/sdk` version, and that documentation SHALL be consulted before the implementation relies on either.
14. WHEN a client sends the protocol initialization request, THE MCP_Server SHALL report the server name `lazarus-curse-scanner` and a version string equal to the `version` field of the Scanner_Package `package.json`.
15. WHILE the MCP_Server is running, THE MCP_Server SHALL write only protocol messages to standard output and SHALL write any diagnostic output to standard error.

### Requirement 15: MCP server safety

**User Story:** As a maintainer, I want the MCP server to be inert toward scanned code and the host, so that analyzing hostile legacy code is safe.

#### Acceptance Criteria

1. THE MCP_Server SHALL NOT execute, evaluate, compile, or load as code any part of a scanned source text.
2. THE source files of the Scanner_Package under `src/` SHALL NOT import or require `node:vm`, `node:child_process`, `node:worker_threads`, `node:fs`, `node:net`, `node:http`, `node:https`, `node:dgram`, or `node:dns` (with or without the `node:` prefix, statically or dynamically), and SHALL NOT call `eval`, `new Function`, or `Function(...)`.
3. THE input schemas of both tools SHALL contain no property whose name or description designates a file path, a directory, a URL, or a command, so that the MCP_Server reads no filesystem path and opens no network connection for scanned input.
4. THE MCP_Server SHALL write only MCP protocol messages to standard output, so that every line written to standard output is one complete, newline-terminated, valid JSON-RPC 2.0 message.
5. THE MCP_Server SHALL write diagnostic output only to standard error, and SHALL limit each diagnostic line to a constant event message, a tool name, an error code, and a duration in milliseconds.
6. THE MCP_Server SHALL NOT write any part of a scanned source text, of a tool argument value, or of a Curse_Finding (including any substring, excerpt, or line content of them) to standard error, and SHALL NOT write them to standard output except inside the JSON-RPC response to the tool call that produced them.
7. WHEN the MCP_Server starts, THE MCP_Server SHALL write 0 bytes to standard output before it receives the first client message.
8. THE MCP_Server SHALL read no environment variable to determine its behavior.
9. THE MCP_Server SHALL return identical tool results for identical tool arguments whether `NODE_ENV` is unset or set to `development`, `production`, or `test`.
10. IF `arguments` of a tool call is an object that contains a property that is not declared in that tool's input schema, THEN THE MCP_Server SHALL reject the call with a tool result with `isError` set to `true` as defined in Requirement 14 criterion 8, SHALL perform no scan, and SHALL read no filesystem path and open no network connection for that call. IF `arguments` of a tool call is present and is not an object, THEN THE MCP_Server SHALL reject the call with the JSON-RPC `InvalidParams` protocol error defined in Requirement 14 criterion 8, SHALL perform no scan, and SHALL read no filesystem path and open no network connection for that call.

### Requirement 16: Compatibility with the Registration and manual enablement

**User Story:** As a Kiro user, I want clear steps to enable the scanner in Kiro, so that I can turn it on after the first build.

#### Acceptance Criteria

1. WHEN a client starts the process `node ./packages/mcp-curse-scanner/dist/index.js` with the Workspace_Root as working directory and the environment `NODE_ENV=development`, THE MCP_Server SHALL return a successful response to the MCP `initialize` request within 10,000 milliseconds, measured from process spawn to receipt of the response by the client.
2. WHEN a client sends an MCP `tools/list` request after the `initialize` handshake completes, THE MCP_Server SHALL return a set of tool names that equals, as an unordered set of exact case-sensitive strings with no missing and no additional names, the `autoApprove` list of the Registration (`scan_ast_curses`, `extract_function_signatures`).
3. THE Scanner_Package SHALL NOT create, modify, or delete `.kiro/settings/mcp.json` or any other file under `.kiro/settings/` in any of its deliverables, including source files, build scripts, and install scripts.
4. THE README of the Scanner_Package SHALL document the manual enablement step as three steps in this order: (1) run `pnpm build`, (2) change `"disabled": true` to `"disabled": false` for the server `lazarus-curse-scanner` in `.kiro/settings/mcp.json`, (3) reload the MCP servers in Kiro.
5. THE README of the Scanner_Package SHALL state that the Registration stays `"disabled": true` until the file `packages/mcp-curse-scanner/dist/index.js` exists, and that the user must not set `"disabled": false` before `pnpm build` has completed successfully.

### Requirement 17: Agreement with the spec 01 seed data

**User Story:** As a maintainer, I want the scanner to agree with the seeded sample corpses, so that the curses stored by the Foundation_Spec and the curses reported by the Curse_Scanner are consistent.

#### Acceptance Criteria

1. WHEN the agreement tests run, THE agreement tests SHALL discover the Sample_Sources as the immediate subdirectories of `db/seed/`, SHALL read for each Sample_Source only the files `legacy.js` and `sample.json`, and SHALL replace every CR LF in the text of `legacy.js` with LF before using it.
2. WHEN the Curse_Scanner scans the `legacy.js` of a Sample_Source with the Source_Language given by the `sourceLanguage` field of its `sample.json`, THE Curse_Scanner SHALL return a success value and not a Scan_Error.
3. WHEN the Curse_Scanner scans the `legacy.js` of a Sample_Source as described in criterion 2, THE `curses` list SHALL contain, for every Seeded_Curse of that Sample_Source, at least one Curse_Finding whose `curseType` equals the `type` of the Seeded_Curse and whose `lineNumber` equals the Seeded_Line of the Seeded_Curse.
4. THE `severity` of every Curse_Finding that satisfies criterion 3 for a Seeded_Curse SHALL equal the `severity` of that Seeded_Curse.
5. THE agreement tests SHALL treat the list of Seeded_Curses as a lower bound and SHALL accept additional Curse_Findings that are not seeded.
6. WHEN `extractFunctionSignatures` scans the `legacy.js` of a Sample_Source as described in criterion 2, THE Curse_Scanner SHALL return a success value that contains exactly one Function_Signature whose `name` equals the `entryFunction` field of the `sample.json`, and that Function_Signature SHALL have `nestingDepth` equal to 0 and `kind` equal to `declaration`.
7. IF the directory `db/seed/` does not exist or contains no Sample_Source, THEN THE agreement tests SHALL finish with the status failed (not skipped and not passed) and SHALL report a failure message that names the Foundation_Spec as an unmet prerequisite and names the missing directory.
8. IF a Sample_Source lacks `legacy.js` or `sample.json`, or its `sample.json` is not valid JSON, or its `sample.json` lacks a valid `sourceLanguage` (one of the three Source_Language values), a valid `entryFunction` (a non-empty string), or a valid `curses` array (at least one entry, each with a `type` that is a Curse_Type, a `severity` that is a Severity, and a non-empty string `match`), or the `match` of a Seeded_Curse does not occur in `legacy.js`, THEN THE agreement tests SHALL finish with the status failed (not skipped and not passed) and SHALL report a failure message that names the Foundation_Spec as an unmet prerequisite, the affected Sample_Source, and the missing or invalid file or field.
9. IF the agreement tests detect that a Seeded_Curse has no matching Curse_Finding under criterion 3, or that the number of Function_Signature objects named like the Entry_Function is not 1, THEN THE agreement tests SHALL finish with the status failed and SHALL report a failure message that names the Sample_Source, the Curse_Type and the Seeded_Line (or the Entry_Function), and the `lineNumber` values of the Curse_Findings of that Curse_Type that the Curse_Scanner returned.
10. THE agreement tests SHALL read no database and no environment variable, SHALL import and execute no file under `db/`, and SHALL leave every file under `db/` byte-identical to its content before the run, so that the migrations `V1__create_lazarus_schema.sql` and `V2__seed_sample_corpses.sql`, the seed files, and the harness stay unchanged.

### Requirement 18: Test strategy for the Curse_Scanner and the MCP_Server

**User Story:** As a maintainer, I want unit, property-based, and protocol tests for the scanner, so that detection rules, determinism, and MCP behavior are verified and not only reviewed.

#### Acceptance Criteria

1. THE Scanner_Package tests SHALL contain, for every positive and negative example named in Requirements 4 to 9, one test whose input is a Curse_Corpus snippet and whose expected result is the exact list of Curse_Finding `curseType` and `lineNumber` values, in the order defined in Requirement 11.
2. THE Scanner_Package tests SHALL include a property-based test with at least 100 runs that checks, for any generated string of 0 to 10,000 characters, including random Unicode text, lone surrogates, and NUL characters, and for each of the three Source_Languages, that `scanCurses` and `extractFunctionSignatures` never throw and return either a success value or a Scan_Error with one of the five defined codes.
3. THE Scanner_Package tests SHALL include a property-based test with at least 100 runs that checks determinism: scanning the same generated program of 1 to 200 lines twice yields byte-identical JSON, and the `curses` list is sorted per Requirement 11. Programs of 1 to 200 lines are far from the parser stack limit, so the generated programs are never Stack_Limit_Sources and the exception of Requirement 11 criterion 1 does not apply to this test.
4. THE Scanner_Package tests SHALL include a property-based test with at least 100 runs that checks, for programs of 1 to 200 lines generated from the Clean_Corpus grammar and for programs with injected curse snippets, that every `lineNumber` is an integer from 1 to the Line_Count.
5. THE Scanner_Package tests SHALL include a property-based test with at least 100 runs that checks, for every generated program of the Clean_Corpus, that the Curse_Scanner returns zero findings and that no function of the program is reported with any Impurity_Marker.
6. THE Scanner_Package tests SHALL include a metamorphic property-based test with at least 100 runs: when a curse snippet from the Curse_Corpus is inserted on its own lines into a program of the Clean_Corpus at a generated top-level statement boundary of the program (before the first line of a top-level statement, or after the last line of the program), and the identifiers of the snippet are disjoint from the identifiers of the Clean_Corpus, the Curse_Scanner reports the expected `curseType` at the expected `lineNumber`, and the findings of the unmodified program, after the line shift, stay unchanged in `curseType`, `severity`, and `column`.
7. THE Scanner_Package tests SHALL include property-based tests with at least 100 runs each for the line shift (Requirement 11 criterion 8), using generated shifts of 1 to 1,000 lines, and for the LF to CR LF conversion (Requirement 11 criterion 9).
8. THE Scanner_Package tests SHALL include unit tests for the resource limits: a source of exactly the Source_Size_Limit is not rejected with `INPUT_TOO_LARGE` and a source of one byte above it yields `INPUT_TOO_LARGE`; a source with a node count above the Node_Limit yields `LIMIT_EXCEEDED`; a source with nesting far above the Depth_Limit (at least 100,000 levels) yields `LIMIT_EXCEEDED` without throwing; a source with nesting of exactly the Depth_Limit, built from a nesting construct for which the parser completes in the Node.js 24 test environment, is not rejected with `LIMIT_EXCEEDED`, and a source with one level above the Depth_Limit built from the same construct yields `LIMIT_EXCEEDED`; if no source text of exactly 512 levels of tree depth can be parsed to completion by the installed parser on Node.js 24 (determined by a test that tries every nesting construct used by these tests and records the outcome), the depth rule SHALL instead be verified on a synthetic syntax tree of exactly 512 levels (not rejected with `LIMIT_EXCEEDED`) and on a synthetic syntax tree of 513 levels (yields `LIMIT_EXCEEDED`), both passed directly to the visitor, while the node-count boundary and the stack-exhaustion behavior stay verified through the parser; sources with nesting from 400 to 1,000 levels yield either a success value or `LIMIT_EXCEEDED` and never throw, and these sources are Stack_Limit_Sources, so the tests check only this outcome for them and do not compare repeated results byte for byte; and a syntax error at a known position on a line greater than 1 yields `SYNTAX_ERROR` with the expected 1-based `line` and `column`.
9. THE Scanner_Package tests SHALL include an integration test that starts `dist/index.js` as a child process, connects with the MCP SDK client over stdio, lists the tools, calls both tools with valid arguments, with arguments that fail validation, with a source that has a syntax error, with `arguments` present and not an object (for example a string and an array, sent as raw JSON-RPC requests over stdio when the SDK client does not allow them), and with an unknown tool name, verifies that each non-object `arguments` call yields a JSON-RPC `InvalidParams` error and that the server answers a following valid call, verifies the results of Requirement 14, and terminates the child process when it ends or when 30,000 milliseconds have elapsed.
10. THE Scanner_Package integration test SHALL verify that every line written to standard output is a valid JSON-RPC message and that a unique marker string placed in a scanned source and in an invalid argument value appears in neither standard output outside the tool result nor in standard error.
11. THE Scanner_Package tests SHALL scan every file under `src/` for the forbidden imports and calls of Requirement 15 criterion 2 and SHALL fail with a message naming the file and the forbidden import or call if one is present.
12. THE Scanner_Package `test` task SHALL depend on the `build` task of the same package in the package-level Turborepo configuration (`packages/mcp-curse-scanner/turbo.json`).
13. THE Scanner_Package `test` task SHALL set `cache` to `true` in the package-level Turborepo configuration, because its tests are hermetic, and SHALL declare as cache inputs the default inputs of the package together with the seed files that the agreement tests read, `db/seed/*/legacy.js` and `db/seed/*/sample.json`, so that Turborepo does not reuse a cached result after any of those files changes.
14. THE name of every test in the Scanner_Package SHALL start with the requirement and criterion that the test verifies, in the form `R<number>.<number>`, and every property-based test SHALL carry the tag comment `Feature: 02-scanner-and-verifier, Property <n>: <title>`.
15. IF a property-based test fails, THEN THE Scanner_Package test run SHALL report the random seed and the shrunk counterexample of the failing run and SHALL exit with a non-zero status.

### Requirement 19: Documentation

**User Story:** As a new contributor, I want a README in the scanner package, so that I can build, use, and enable the package without reading the source.

#### Acceptance Criteria

1. THE Scanner_Package SHALL provide a `README.md` at the package root whose level-2 headings, in this order and with these exact titles, are: `Overview`, `Build and test`, `Library usage`, `Detection rules`, `Result and error formats`, `Limits`, `MCP tools`, and `Enabling the MCP server in Kiro`, where:
   - `Overview` states in 1 to 5 sentences what the package does.
   - `Library usage` contains one code example that calls `scanCurses` and one that calls `extractFunctionSignatures`, each showing the import, the call, and the handling of a result with `ok` set to `false`.
   - `Detection rules` contains a table with exactly six rows, one per Curse_Type in the Curse_Type_Order, with the columns Curse_Type and Severity, and each Severity equals the mapping of Requirement 10 criterion 1.
   - `Result and error formats` lists the fields of a success Scan_Result, of a Curse_Finding, and of a Scan_Error, and lists the five Scan_Error codes.
   - `Limits` lists each numeric limit of Requirement 12 with its value.
   - `MCP tools` lists `scan_ast_curses` and `extract_function_signatures`, each with its input schema and its output format as defined in Requirement 14.
2. THE `Enabling the MCP server in Kiro` section of the README of the Scanner_Package SHALL state, as three numbered steps in this order, the manual enablement of Requirement 16 criterion 4: run `pnpm build`; change `"disabled": true` to `"disabled": false` for the server `lazarus-curse-scanner` in `.kiro/settings/mcp.json`; reload the MCP servers in Kiro. THE same section SHALL state that the Registration stays disabled until `packages/mcp-curse-scanner/dist/index.js` exists (Requirement 16 criterion 5).
3. THE `Overview` section of the README of the Scanner_Package SHALL state that its findings are static heuristics that can miss or over-report constructs.
4. THE prose, code comments, table text, and identifiers in the examples of the README SHALL be written in English.
5. THE README of the Scanner_Package SHALL contain none of the Forbidden_Phrases anywhere in its text, including code examples, compared case-insensitively.
6. THE `Build and test` section of the README SHALL list the exact shell commands, run from the Workspace_Root, that build the package, lint it, and run its tests, and each listed command SHALL exit with code 0 on a clean checkout after `pnpm install`.
7. THE code examples in the README SHALL import only names that the Scanner_Package exports and SHALL compile without type errors against the package's emitted type declarations.

### Requirement 20: Scope boundary and environment

**User Story:** As a reviewer, I want this spec to stay small, so that the review covers only the scanner package.

#### Acceptance Criteria

1. THE Scanner_Package deliverables SHALL limit every file they create, modify, or delete to paths inside `packages/mcp-curse-scanner` and `pnpm-lock.yaml`, where the `pnpm-lock.yaml` changes are limited to entries for dependencies declared by the Scanner_Package.
2. THE Scanner_Package deliverables SHALL NOT create, modify, or delete any file under `apps/web`, `db/`, `scripts/`, `packages/pbt-verifier`, or `.kiro/settings/`, and a repository diff of those paths against the pre-change commit SHALL be empty.
3. THE Scanner_Package SHALL NOT call any LLM, SHALL NOT read from or write to any database, and SHALL NOT open any network connection, both at runtime and during execution of its own tests.
4. THE Scanner_Package SHALL read no environment variable (including through `process.env`), and `.env.example` SHALL contain no variable that was not present before this spec.
5. THE Scanner_Package SHALL treat imported legacy code only as inert text, and SHALL NOT evaluate, compile, dynamically import, or run as a separate process any code supplied by a user, whether as a string or as a file path.
