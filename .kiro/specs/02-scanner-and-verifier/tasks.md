# Implementation Plan: Curse Scanner Package and MCP Server

## Overview

This plan builds one workspace package, `packages/mcp-curse-scanner` (`@lazarus/mcp-curse-scanner`), as described in `design.md`: a deterministic static analyzer for legacy JavaScript built on `acorn`, exposed as a TypeScript library (`scanCurses`, `extractFunctionSignatures`) and as an MCP server over stdio (`scan_ast_curses`, `extract_function_signatures`). The work goes in this order: package scaffolding with a first build, lint, and test checkpoint; the scanner core in layers (types, input, line index, deadline, ES3 reserved-word plugin, parser, visitor with `analyzeTree`, depth and limit test support, detectors, function signatures); generators and the scanner property tests; the MCP server with its handler tests, integration tests, and source scan; the agreement tests against the seed data; packaging tests; the README; and a final checkpoint. Each layer is followed by its unit tests and property tests.

The equivalence verifier (`packages/pbt-verifier`) belongs to spec `03-pbt-verifier` and is not part of this plan.

Scope and conventions:

- Only files inside `packages/mcp-curse-scanner` and `pnpm-lock.yaml` are created or changed. Nothing under `db/`, `scripts/`, `apps/web`, `packages/pbt-verifier`, `.kiro/settings/`, or at the repository root is edited (Requirements 1.11, 20.1, 20.2). The agent cannot edit `.kiro/settings/mcp.json`; the user enables the Registration by hand. No task reads or prints `.env`, and the package reads no environment variable (Requirement 20.4).
- All code, comments, test names, error messages, and documentation are in English. No explicit `any`.
- Use the dependency versions listed in `design.md`. Where the design lists an item under "To re-verify at implementation time", read the documentation or the installed package for the version in `pnpm-lock.yaml` before relying on the API, and follow what the installed version does.
- Every test name starts with `R<number>.<number>` for the requirement and criterion it verifies (Requirement 18.14). Every property test is one `fc.assert(fc.property(...))` with at least 100 runs and carries the comment `Feature: 02-scanner-and-verifier, Property <n>: <title>`, with `<n>` from 1 to 17 as numbered in `design.md`. A supporting check that has no design property number uses the comment `Feature: 02-scanner-and-verifier, Supporting check: <title>`.
- Property tests, the MCP integration tests, the agreement tests, and the source scans are not optional, because Requirements 17 and 18 make them part of the deliverable. Only a few helper-level unit tests that duplicate other coverage are marked optional with `*`.

Decisions taken (approved, and reflected in the final `requirements.md` and `design.md`):

- **Stack-limit exception.** A `Stack_Limit_Source` (a source whose nesting sits at or near the parser stack limit) gets only the guarantee "success value or `LIMIT_EXCEEDED`, never a throw" (Requirements 11.1, 11.6, 12.3, 12.8). The byte-identical guarantee applies to every other source. The determinism, line-shift, line-ending, and cross-process tests use only programs of 1 to 200 lines whose syntax tree depth is at most 40, or shallow fixed inputs. Stack-sensitive shapes at 400 to 1,000 levels get only the weak assertion.
- **Depth-512 fallback on synthetic trees.** The visitor entry point `analyzeTree(tree, lineIndex, deadline)` is exported from `visit.ts` for tests only. A depth-capability record (`test/support/depth-capability.ts`) lists the nesting constructs that parse at exactly 512 and 513 levels. Synthetic-tree tests (512 accepted, 513 rejected, 100,000 levels rejected, node-count boundaries) are always registered and never skipped. Parser-based exact-limit tests remain for the node-count boundary and for every depth construct that parses at 512 (baseline: member chain and call chain). A change from the baseline prints a `WARN` line and does not fail the run (Requirement 18.8).
- **ES3 reserved words.** `es3` uses `allowReserved: false` plus the `Es3Parser` plugin in `src/scanner/es3-reserved.ts` (`Parser.extend`, overriding `checkUnreserved`, checking the decoded name against the 31 `ES3_Reserved_Words`). The plugin covers `const` and escaped identifiers and reports the error at the identifier's first character. Reserved words as property names stay accepted (Requirement 3.13). A guard test fails with a clear message if `checkUnreserved` is no longer a prototype method of acorn's parser; the fallback (a post-parse identifier check) is described in task 4.5 and is implemented only if the guard fails.
- **Narrowed 14.8 and 15.10 split.** An absent `arguments`, or an object that fails the zod schema, gives a tool result with `isError: true` that names the invalid properties. A present `arguments` that is not an object (string, array, `null`, number, boolean) gives a JSON-RPC `InvalidParams` error (-32602) raised by the SDK before the handler runs, with no scan, and the server answers the next request.

Environment notes:

- The agreement tests (task 12) depend on the seed files under `db/seed/` as they exist now: `db/seed/invoice-totals` (`es3`, entry function `computeInvoiceTotal`), `db/seed/query-string-parser` (`es5-jquery`, `parseQueryString`), and `db/seed/batch-calculator` (`legacy-node`, `calculateBatch`). Each holds `legacy.js` and `sample.json`, plus `modern.ts` and `test-code.js`, which the tests never read. The tests read `legacy.js` and `sample.json` as text and fail (never skip) when those files or their fields are missing or changed incompatibly.
- The repository shows an empty `packages/` directory, so the package files are all new.
- `vitest.shared.ts` at the repository root has a default export. The package Vitest config uses the default import.
- The root ESLint config already ignores `**/dist/**` and `packages/**/test/fixtures/**`.
- The development machine may run Node older than 24 (`.npmrc` sets `engine-strict`). If `pnpm install` refuses to run, stop and ask the user to install Node 24. `pnpm` may also be missing on the machine.
- The exact-limit shapes were measured on Node 23.5.0. The depth-capability guard (task 5.8) re-checks them on the installed Node version.

## Tasks

- [x] 1. Scaffold the package
  - [x] 1.1 Create the package files
    - Create `packages/mcp-curse-scanner/package.json` exactly as in `design.md` (ESM, `private`, `engines.node >=24`, `main`/`types`/`exports["."]` pointing to `dist/lib.js` and `dist/lib.d.ts`, `files`, scripts `build` = `node scripts/clean.mjs && tsc -p tsconfig.build.json`, `test` = `vitest run`, `lint` = `eslint . && tsc --noEmit -p tsconfig.json`)
    - Dependencies `@modelcontextprotocol/sdk@^1.32.2`, `acorn@^8.19.0`, `zod@^4.6.7`; devDependencies `@types/node@^24.19.2`, `acorn-walk@^8.3.5`, `eslint@^10.14.0`, `fast-check@^4.10.2`, `typescript@^6.0.3`, `vitest@^5.1.0`
    - Create `tsconfig.json` (extends `../../tsconfig.base.json`, no `strict` override, `types: ["node"]`, `noEmit`, `allowImportingTsExtensions`, include `src`, `test`, `vitest.config.ts`) and `tsconfig.build.json` (extends `tsconfig.json`, `noEmit: false`, `allowImportingTsExtensions: false`, `declaration`, `sourceMap`, `outDir dist`, `rootDir src`, include `src` only)
    - Create `vitest.config.ts` that merges the default export of `../../vitest.shared.ts` with `include: ['test/**/*.test.ts']` and `testTimeout: 30000`
    - Create `turbo.json` with `extends: ["//"]` and a `test` task with `dependsOn: ["build"]`, `cache: true`, and `inputs` `$TURBO_DEFAULT$`, `$TURBO_ROOT$/db/seed/*/legacy.js`, `$TURBO_ROOT$/db/seed/*/sample.json`, and `$TURBO_ROOT$/.kiro/settings/mcp.json`
    - Create `scripts/clean.mjs` (removes `dist/` with `node:fs`; it is not under `src/`), an empty library barrel `src/lib.ts` (`export {}`), and a placeholder `src/index.ts` (`export {}`) so the first build emits `dist/index.js`
    - Create `test/unit/package-json.test.ts` that checks the package fields, the three scripts, `engines.node`, and the declared dependencies (smoke test so `vitest run` has one test)
    - Re-check the Turborepo `extends` and `$TURBO_ROOT$` behavior against the installed `turbo` version
    - _Requirements: 1.1, 1.2, 1.6, 1.8, 1.9, 1.10, 1.11, 2.1, 2.3, 2.7, 18.12, 18.13_
  - [x] 1.2 Install dependencies and confirm the toolchain
    - Run `pnpm install`; the only lockfile changes allowed are the entries of this package
    - Confirm `typescript` resolves to 6.x and that one copy of `fast-check`, `vitest`, and `acorn` is shared with the root
    - Check the installed MCP SDK, `zod`, `acorn`, and `fast-check` versions against the "To re-verify at implementation time" list in `design.md` and write down any API difference in the relevant later task before implementing it
    - _Requirements: 1.9, 20.1_

- [x] 2. Checkpoint - Scaffolding builds, lints, and tests
  - Run `pnpm exec turbo run build lint test --filter=@lazarus/mcp-curse-scanner` (or the root `pnpm build`, `pnpm lint`, and `pnpm test`) and confirm the package takes part and every task exits with code 0.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Scanner types, constants, input validation, and line index
  - [x] 3.1 Create the scanner types, constants, and limits
    - Create `src/scanner/types.ts` (`SourceLanguage`, `CurseType`, `Severity`, `ImpurityMarker`, `ScanErrorCode`, `CurseFinding`, `FunctionSignature`, `ScanSuccess`, `SignaturesSuccess`, `ScanError`, `ScanResult`, `SignaturesResult`) with the property order of the design
    - Create `src/scanner/constants.ts` (Curse_Type_Order, the severity, `description`, and `exorcismStrategy` table of the design, impurity marker order, watched names) and `src/scanner/limits.ts` (`LIMITS`: 1,048,576 bytes, 200,000 nodes, depth 512, 5,000 ms)
    - Re-export the types and `LIMITS` from `src/lib.ts`
    - Texts are printable ASCII, 10 to 500 characters, pairwise different, without interpolation and without the Forbidden_Phrases
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 11.5, 12.1, 12.2, 12.3, 12.4_
  - [ ]* 3.2 Write unit tests for the constants table
    - Create `test/unit/constants.test.ts`: severity mapping, ASCII range, length range, pairwise difference, absence of Forbidden_Phrases, `description` not equal to any `exorcismStrategy`
    - Optional because Property 10 covers the same rules through real findings
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6_
  - [x] 3.3 Implement input validation and the UTF-8 size rule
    - Create `src/scanner/input.ts`: runtime check of `source` (string) and `sourceLanguage` (exactly one of three values, case-sensitive), then `Buffer.byteLength(source, 'utf8')` against 1,048,576
    - Return `INVALID_INPUT` and `INPUT_TOO_LARGE` as Scan_Error values with constant messages, never throw
    - _Requirements: 3.7, 3.8, 12.2, 12.5, 12.9_
  - [x] 3.4 Write the UTF-8 size property test and input unit tests
    - **Property 7: UTF-8 size rule**
    - **Validates: Requirements 12.2**
    - Create `test/property/utf8-size.property.test.ts`; include lone surrogates counted as 3 bytes, and a unit test for exactly 1,048,576 bytes (accepted) and one byte more (rejected)
    - Create `test/unit/input.test.ts` for non-string sources, bad language values (case-sensitive), and error precedence
    - _Requirements: 3.7, 3.8, 12.2, 12.9_
  - [x] 3.5 Implement the line index
    - Create `src/scanner/line-index.ts`: `Uint32Array` of line starts for LF, CR, CR LF (one), U+2028, and U+2029; `lineCount`; `position(offset)` by binary search returning a 1-based line and a 1-based column in UTF-16 code units
    - _Requirements: 3.3, 3.9, 11.7, 13.5_
  - [x] 3.6 Write line index tests
    - Create `test/unit/line-index.test.ts`: tab counts as one unit, an astral character counts as two, empty source gives a count of 1, CR LF counts once
    - Add a supporting property test (at least 100 runs, comment `Feature: 02-scanner-and-verifier, Supporting check: Line index agrees with acorn locations`) that compares the index with acorn `locations: true` output for generated sources with all five terminators
    - _Requirements: 3.3, 11.7, 11.9, 13.5_

- [x] 4. Parser options, ES3 reserved words, and deadline
  - [x] 4.1 Implement the deadline
    - Create `src/scanner/deadline.ts` with an injectable `now`, a 5,000 ms limit, `check()` that throws an internal abort marker for `TIMEOUT`, and the 256-step counter helper used by the token callback and the visitor
    - _Requirements: 12.4, 12.9_
  - [x] 4.2 Implement the ES3 reserved-word plugin
    - Create `src/scanner/es3-reserved.ts`: export `ES3_RESERVED_WORDS` (a `ReadonlySet<string>` of the 31 words of the Glossary) and `Es3Parser = Parser.extend(...)` from `acorn`, a class that overrides `checkUnreserved(ref)` to raise `The keyword '<name>' is reserved` at `ref.start` when the decoded `ref.name` is in the set, and then calls `super.checkUnreserved(ref)`
    - The check uses the decoded name, so the escaped forms `c\u006Cass` and `c\u006Fnst` are rejected, and it covers `const`, which acorn's own ES3 list omits
    - The error position is the first character of the identifier, in source order with the rest of the grammar (acorn calls `checkUnreserved` only for identifiers, so property names such as `a.class` and `{class: 1}` stay accepted)
    - `checkUnreserved` and `raise` are not in acorn's published declarations: type them with a small local interface or a cast under `strict` and no explicit `any`
    - Keep `src/scanner/es3-reserved.ts` free of any import other than `acorn`
    - _Requirements: 3.13, 3.12_
  - [x] 4.3 Implement parsing per Source_Language
    - Create `src/scanner/parse.ts`: `es3` = `Es3Parser.parse` with `ecmaVersion 3` and `allowReserved: false`; `es5-jquery` = `acorn.parse` with `ecmaVersion 5`; `legacy-node` = `acorn.parse` with `ecmaVersion 5`, `allowHashBang`, and `allowReturnOutsideFunction`; all with `sourceType: 'script'`, no `locations`, and an `onToken` callback that calls the deadline. Use `Es3Parser` for `es3` only.
    - Map an acorn `SyntaxError` to `SYNTAX_ERROR` with `line` and `column` from `pos` through the line index and a message cut to 500 characters without the trailing position suffix. A reserved-word error raised by `Es3Parser` maps the same way, with the position of the identifier's first character.
    - Map a `RangeError`, or a `SyntaxError` whose message starts with `Not enough stack space to parse input`, to `LIMIT_EXCEEDED` without `line` and `column`, even when the nesting is below the Depth_Limit (such a source is a `Stack_Limit_Source`; only "success value or `LIMIT_EXCEEDED`, never a throw" is guaranteed for it)
    - Use `allowReserved: false`, not `"never"`: reserved words as property names (`a.class`, `{class: 1}`) stay accepted in `es3`
    - _Requirements: 3.4, 3.5, 3.6, 3.11, 3.12, 3.13, 12.1, 12.3, 12.6_
  - [x] 4.4 Write parser unit tests
    - Create `test/unit/parse.test.ts`: `let`, `const`, arrow function, template literal, class, and import give `SYNTAX_ERROR` in all three languages; `let;` parses as ES5; hashbang accepted only at offset 0 for `legacy-node` and rejected for the other two (a hashbang on line 2 is rejected for all); `return` outside a function accepted only for `legacy-node`; error `line` and `column` for a known position on line 3; 20,000 nested parentheses map to `LIMIT_EXCEEDED` without throwing
    - ES3 reserved words are covered by task 4.5 and not repeated here
    - _Requirements: 3.4, 3.5, 3.6, 3.11, 3.12, 12.1, 12.3_
  - [x] 4.5 Write ES3 reserved-word tests and the plugin guard
    - Create `test/unit/es3-reserved.test.ts`. The test file holds its own literal copy of the 31 words of the Glossary and asserts that `ES3_RESERVED_WORDS` equals it.
    - Table test over all 31 words with `sourceLanguage: 'es3'`. Rejected as identifiers (`SYNTAX_ERROR`, with `line` and `column` equal to the 1-based position of the word, computed by the test from the template): `var <w> = 1;`, `function <w>() {}`, `function f(<w>) {}`, `x = <w>;`, `try {} catch (<w>) {}`, `<w>: for (;;) {}`, `var f = function <w>() {};`, and `var a, <w>;`. Accepted as property names: `a.<w> = 1;`, `var o = {<w>: 1};`, `var v = o.<w>;`, and `o.<w>();`. For `debugger`, the identifier forms are rejected through acorn's keyword path (assert the position and not the message), and the statement `debugger;` stays valid.
    - Named tests, one per example of Requirement 3.13. Rejected: `var class = 1;`, `var int;`, `function enum() {}`, `function f(class) {}`. Accepted: `a.class = 1;`, `var o = {class: 1};`, `var v = o.int;`.
    - Extra named tests: `const x = 1;` is rejected in `es3` (position 1:1); `var const = 1;` is rejected (position 1:5); the escaped forms `var c\u006Cass = 1;` and `var c\u006Fnst = 1;` are rejected; `a.c\u006Cass = 1;` is accepted; `var const = 1; var @x;` reports the `const` (1:5) and not the `@`; a reserved word on line 3 gives the expected `line` and `column`
    - Language contrast: with `es5-jquery`, `var int = 1;` is accepted and `var class = 1;` is rejected
    - Guard test `R3.13 acorn exposes checkUnreserved as a prototype method`: fail with a clear message that names the installed acorn version, says that `Es3Parser` in `src/scanner/es3-reserved.ts` relies on `Parser.prototype.checkUnreserved`, and names the fallback, when `typeof acorn.Parser.prototype.checkUnreserved` (read through a cast) is not `function`
    - Fallback, described only and not implemented unless the guard fails: replace the plugin with a post-parse check that walks the finished tree iteratively and reports the first `Identifier` (by start offset) that is not a non-computed property name or an object key and whose name is in `ES3_RESERVED_WORDS`, as a `SYNTAX_ERROR` at that identifier. Its known limit is that an unrelated later syntax error is reported instead of an earlier reserved word, which is why the plugin is the primary choice.
    - _Requirements: 3.12, 3.13_
  - [ ]* 4.6 Write deadline unit tests
    - Create `test/unit/deadline.test.ts` with a fake clock: no abort at exactly the limit, abort one tick after, check frequency
    - Optional because task 5.10 tests `TIMEOUT` through the scan entry point
    - _Requirements: 12.4_

- [x] 5. Iterative visitor, scopes, results, scan entry points, and limit test support
  - [x] 5.1 Implement the iterative visitor
    - Create `src/scanner/child-keys.ts` (the ES5 node types and child key order from the design table) and `src/scanner/visit.ts`: explicit task stack (no recursion over the tree), `role` per child (`ref`, `skip`, `declare`, `write`, `callArg`), enter and exit hooks, node count and depth counters (Program is depth 1 and node 1), deadline check every 256 nodes
    - Export `analyzeTree(tree, lineIndex, deadline)` and the `TreeNode` and `AnalysisOutcome` types from `visit.ts`, for tests only. `scan.ts` is the single production caller, and `lib.ts` does not re-export them. `analyzeTree` enforces the Node_Limit and the Depth_Limit on whatever tree it is given, whether acorn or a test built it, and returns `LIMIT_EXCEEDED` as soon as node 200,001 or depth 513 is reached and `TIMEOUT` on expiry. An unknown node type is an internal failure handled by `runScan`.
    - _Requirements: 12.3, 12.4_
  - [x] 5.2 Implement scope resolution
    - Create `src/scanner/scopes.ts`: program, function, and catch scopes; declarations (parameters, `var` anywhere in the function, function declaration names, `arguments`, named function expression names, catch parameter); pending read and write items resolved on scope exit; unresolved writes exposed for GLOBAL_POLLUTION
    - _Requirements: 4.1, 4.2, 4.5, 4.6_
  - [x] 5.3 Implement result building and the detector registry
    - Create `src/scanner/results.ts`: findings keyed by `(curseType, start offset)`, sorted by offset then Curse_Type_Order, built with literal property order (`ok`, `sourceLanguage`, `lineCount`, list), success and error builders
    - Create `src/scanner/detectors.ts` with the detector context (record a finding at a node start offset, access to scopes) and a `createDetectors` function that returns the hooks of all registered detectors (none yet)
    - _Requirements: 10.1, 10.7, 11.2, 11.3, 11.4, 11.5, 12.7_
  - [x] 5.4 Implement the scan entry points
    - Create `src/scanner/scan.ts` with `runScan(source, language, mode, hooks?)` (injectable `now` and `timeBudgetMs`): validate, size, line index, parse, `analyzeTree`, build results; one outer `try/catch` that maps an internal exception to `LIMIT_EXCEEDED` with the message `Internal scan failure` and an abort marker to `TIMEOUT`
    - Export `scanCurses` and `extractFunctionSignatures` from `src/lib.ts` (the function list is empty until task 7.1)
    - _Requirements: 3.1, 3.2, 3.3, 3.9, 3.10, 12.3, 12.5, 12.7, 12.8, 12.9, 13.15_
  - [x] 5.5 Write visitor tests
    - Create `test/unit/visit.test.ts`: children are visited in source order, exit hooks run in reverse nesting order, no recursion over a 500,000-node left-leaning synthetic chain built iteratively
    - Add a child-keys completeness test: the visitor node count equals the count of a generic walk (every object with a string `type`) for sample programs
    - _Requirements: 12.3_
  - [ ]* 5.6 Write scope unit tests
    - Create `test/unit/scopes.test.ts`: hoisted `var` after use, nested function resolution, catch parameter visible only in its block, named function expression name, `arguments`
    - Optional because the GLOBAL_POLLUTION corpus (task 6.7) covers the same rules
    - _Requirements: 4.2, 4.5_
  - [x] 5.7 Create the limit shape builders
    - Create `test/support/shapes.ts` with builders for the sources of the design section "Resource-limit test shapes": flat list `';'.repeat(n)`, member chain `'a' + '.a'.repeat(n) + ';'`, call chain `'a' + '()'.repeat(n) + ';'`, nested parentheses, arrays, blocks, callbacks, object literals, functions, unary chains, ternaries, and left-leaning binary chains, each from a size parameter
    - _Requirements: 12.3, 18.8_
  - [x] 5.8 Create the depth-capability record and its guard test
    - Create `test/support/depth-capability.ts` with `measureDepthCapability()`, computed once per test file. For every nesting construct the tests use (member chain, call chain, nested arrays, nested blocks, nested functions, nested callbacks, nested object literals, unary chain, ternary chain, left-leaning binary chain) and for `es3` and `es5-jquery`, build the source whose tree depth should be exactly 512 and the one for 513, parse each directly with `acorn.parse` (`Es3Parser.parse` for `es3`), and measure depth and node count with an independent iterative walk. Each attempt is `parsed-exact`, `depth-mismatch`, or `parse-failed`. The record stores `process.version`, `acorn.version`, and `usable512`, the list of constructs for which both the 512 and the 513 source are `parsed-exact` in both languages. Parentheses are not listed, because they build no node.
    - Create `test/unit/depth-capability.test.ts` with the guard test `R18.8 depth-512 capability`: it prints one `console.info` line such as `depth-512 capability: usable = [member-chain, call-chain]; acorn 8.19.0; node v24.x`, and it fails only when the record is incomplete (a construct or language without an outcome)
    - The baseline is `usable512 = [member-chain, call-chain]`. When the record differs, print a second line that starts with `WARN depth-512 capability changed:` and names the constructs gained or lost, the new outcome of each (`parse-failed` or `depth-mismatch`), and the acorn and Node versions. Do not fail the run, because the synthetic-tree tests of task 5.9 keep Requirement 18.8 verified.
    - The same file asserts the node-count precondition and fails the run if it breaks: `';'.repeat(199_999)` parses with exactly 200,000 nodes and depth 2, and `';'.repeat(200_000)` parses with 200,001 nodes. The failure message names the shape, the node counts found, and the acorn and Node versions.
    - Only the guard test may use `console.info`; the source scan of task 10.14 covers `src/` only
    - _Requirements: 12.3, 18.8_
  - [x] 5.9 Create the synthetic-tree builders and the always-registered depth tests
    - Create `test/support/synthetic-tree.ts` with iterative builders (no recursion): `makeChainTree(depth)` returns `Program → ExpressionStatement → MemberExpression × (depth − 3) → Identifier` with exactly the requested depth, and `makeFlatTree(nodes)` returns a `Program` with `nodes − 1` `EmptyStatement` children. Every node gets valid `start` and `end` offsets in a one-line source `"a"`, and the matching line index is returned with the tree.
    - Create `test/unit/analyze-tree.test.ts` with tests that call `analyzeTree` directly and are always registered (never skipped, never conditional on the capability record): `makeChainTree(512)` gives a success value, `makeChainTree(513)` gives `LIMIT_EXCEEDED`, `makeChainTree(100_000)` gives `LIMIT_EXCEEDED` without a stack error, `makeFlatTree(200_000)` gives a success value, and `makeFlatTree(200_001)` gives `LIMIT_EXCEEDED`. A tree that has an expired deadline gives `TIMEOUT`. Titles end with `(mode: synthetic)`.
    - _Requirements: 12.3, 12.4, 18.8_
  - [x] 5.10 Write resource limit tests
    - Create `test/unit/scan-limits.test.ts` with the strong assertions of the design for `es3` and `es5-jquery`:
      - Size: a source of exactly 1,048,576 bytes (padded with a comment) is accepted; one byte more gives `INPUT_TOO_LARGE`
      - Nodes through the parser: `';'.repeat(199999)` is accepted; `';'.repeat(200000)` gives `LIMIT_EXCEEDED`
      - Depth through the parser, registered only for the constructs listed in `usable512` of the capability record (baseline: member chain `'a' + '.a'.repeat(509) + ';'` accepted and `'.a'.repeat(510)` rejected; call chain with 509 and 510 links the same). If the record lists none, the synthetic-tree tests of task 5.9 carry the depth rule and these tests are not registered. Titles end with `(mode: parser, construct: <name>)`.
      - Far above the Depth_Limit: member chain and call chain with 100,000 links give `LIMIT_EXCEEDED`; nested arrays, parentheses, and blocks with 100,000 levels give `LIMIT_EXCEEDED` without throwing
      - 20,000 nested parentheses give `LIMIT_EXCEEDED`
      - A syntax error at a known position on line 3 gives the expected `line` and `column`
      - `TIMEOUT` with an injected clock that jumps past the budget returns no lists
    - Stack-sensitive shapes (nested arrays, parentheses, blocks, callbacks, object literals, functions, unary chains, ternaries, and left-leaning binary chains) at 400, 500, 512, 513, 600, 800, and 1,000 levels are `Stack_Limit_Source`s and get only the weak assertion: the call does not throw, and the result is a success value or `LIMIT_EXCEEDED`. These tests do not compare repeated results and do not assert which of the two outcomes occurs.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.8, 18.8_
  - [x] 5.11 Write scan entry point tests
    - Create `test/unit/scan-entry.test.ts`: success shape and fixed property order of results and errors, empty and whitespace-only sources (`lineCount` and no findings), `extractFunctionSignatures` returns the same Scan_Error as `scanCurses` for invalid inputs, a Scan_Error never contains `curses` or `functions`, repeated Scan_Error values (other than `TIMEOUT`, and for sources that are not `Stack_Limit_Source`s) are byte-identical
    - _Requirements: 3.1, 3.2, 3.3, 3.9, 11.1, 11.5, 12.7, 12.8, 13.15_

- [x] 6. Curse detectors
  - [x] 6.1 Create the Curse_Corpus helpers
    - Create `test/support/corpus.ts` with the `CorpusCase` type (`id`, `requirement`, `language`, `source`, `expected` list of `curseType`, `lineNumber`, optional `column`) and a helper that runs a case and asserts the exact finding list in Requirement 11.2 order
    - _Requirements: 18.1_
  - [x] 6.2 Implement the VAR_HOISTING detector
    - Add the detector to `src/scanner/detectors.ts`: one finding per `var` declaration statement (including `for` and `for...in` initializers) at the `var` keyword
    - _Requirements: 5.1, 5.2, 5.3_
  - [x] 6.3 Write VAR_HOISTING corpus tests
    - Create `test/support/corpus/var-hoisting.ts` and `test/unit/detect-var-hoisting.test.ts` for every positive and negative example of Requirement 5 (including `variable`, `vars`, strings, regular expressions, comments, a parameter, empty source)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 18.1_
  - [x] 6.4 Implement the IMPLICIT_COERCION detector
    - Add the detector to `src/scanner/detectors.ts`: one finding per `==` or `!=` binary expression at the start of the expression; `a == b != c` gives two findings at the same position
    - _Requirements: 6.1, 6.4, 6.5_
  - [x] 6.5 Write IMPLICIT_COERCION corpus tests
    - Create `test/support/corpus/implicit-coercion.ts` and `test/unit/detect-implicit-coercion.test.ts` for every example of Requirement 6, including `a\n== b` at line 1, column 1
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 18.1_
  - [x] 6.6 Implement the GLOBAL_POLLUTION detector
    - Add the detector to `src/scanner/detectors.ts`: unresolved assignment targets from scope resolution (any assignment operator), and member assignments whose object is directly `window` or `global`; no finding for update expressions and `for...in` variables
    - _Requirements: 4.1, 4.2, 4.3, 4.6_
  - [x] 6.7 Write GLOBAL_POLLUTION corpus tests
    - Create `test/support/corpus/global-pollution.ts` and `test/unit/detect-global-pollution.test.ts` for every example of Requirement 4, including `a = b = 0;` (two findings, columns 1 and 5) and the later-`var`, enclosing-`var`, and catch-parameter negatives
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 18.1_
  - [x] 6.8 Implement the CALLBACK_HELL detector
    - Add the detector to `src/scanner/detectors.ts`: track `callbackDepth` for function expressions that are direct arguments of a call or `new`; a finding at the `function` keyword when the callback has at least two callback ancestors; other functions neither count nor reset the depth
    - _Requirements: 7.1, 7.2, 7.5, 7.6_
  - [x] 6.9 Write CALLBACK_HELL corpus tests
    - Create `test/support/corpus/callback-hell.ts` and `test/unit/detect-callback-hell.test.ts`: the one-line three-level example gives one finding at the `function` passed to `c`, four levels give two, `new X(function …)` levels, a non-callback function between callbacks, and the negatives (two levels, declaration, assigned function, IIFE, `function () {}.bind(this)`)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 18.1_
  - [x] 6.10 Implement the EVAL_INJECTION detector
    - Add the detector to `src/scanner/detectors.ts`: call with callee identifier `eval` or `Function`, and `new` with callee identifier `Function`, at the start of the expression; parentheses around the callee are transparent; a local declaration does not suppress the finding; member callees do not match
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  - [x] 6.11 Write EVAL_INJECTION corpus tests
    - Create `test/support/corpus/eval-injection.ts` and `test/unit/detect-eval-injection.test.ts` for every example of Requirement 8, including `(eval)(x)`, `eval(eval(x))` (two), `Function('return this')()` (one), a local `eval` declaration, and all negatives
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 18.1_
  - [x] 6.12 Implement the PROTOTYPE_POLLUTION detector
    - Add the detector to `src/scanner/detectors.ts`: assignment (any operator) whose left side is a member with property `__proto__` (identifier or string literal), or a computed member whose property is not a string or number literal; one finding per assignment expression
    - _Requirements: 9.1, 9.2, 9.3_
  - [x] 6.13 Write PROTOTYPE_POLLUTION corpus tests
    - Create `test/support/corpus/prototype-pollution.ts` and `test/unit/detect-prototype-pollution.test.ts` for every example of Requirement 9, including `a[k1] = b[k2] = v;` (two), `obj.__proto__ += 1;`, and the read and update negatives
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 18.1_

- [x] 7. Function signatures and impurity markers
  - [x] 7.1 Implement function signature extraction
    - Create `src/scanner/functions.ts`: one `FunctionInfo` per function declaration and expression with `name` inference (own identifier, `var name = function`, `name = function`, otherwise `null`), `kind`, `params`, `startLine`, `startColumn`, `endLine` (line of offset `node.end - 1`), `nestingDepth`
    - Wire it into the visitor hooks and `src/scanner/scan.ts` so `extractFunctionSignatures` returns the list sorted by start position
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.17, 13.18_
  - [x] 7.2 Implement impurity markers
    - Extend `src/scanner/scopes.ts` and `src/scanner/functions.ts`: `GLOBAL_WRITE`, `OUTER_SCOPE_WRITE` (including `++` and `--`), watched reads for `NONDETERMINISTIC_API`, `TIMER_API`, and `ENVIRONMENT_API` only when the name is undeclared in the program, `Math.random` recognition, propagation to all enclosing functions, fixed marker order without duplicates, `pureCandidate` equal to an empty marker list
    - Make the EVAL_INJECTION detector in `src/scanner/detectors.ts` notify the function tracker so `DYNAMIC_CODE` is added to the innermost function and its ancestors
    - _Requirements: 13.7, 13.8, 13.9, 13.10, 13.11, 13.12, 13.13, 13.16_
  - [x] 7.3 Write function signature unit tests
    - Create `test/unit/functions.test.ts`: `kind`, names (including `obj.name = function () {}` and callbacks giving `null`), `params` order and empty list, positions and `endLine`, `nestingDepth`, sort order, source without functions gives `[]`
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.17, 13.18_
  - [x] 7.4 Write impurity marker unit tests
    - Create `test/unit/impurity-markers.test.ts`: one example per marker, a property named `Date` or `random` on another object adds none, markers propagate to enclosing functions, declared `Date` or `setTimeout` adds none, fixed marker order, `pureCandidate`
    - _Requirements: 13.7, 13.8, 13.9, 13.10, 13.11, 13.12, 13.13, 13.16_

- [x] 8. Generators and scanner property tests
  - [x] 8.1 Create the Clean_Corpus and program generators
    - Create `test/support/clean-corpus.ts`: ES5 program generator (1 to 200 lines, one complete statement or block opener or closer per line, at most 100 characters per line, closed identifier pools `f<n>`, `p<n>`, `m<n>` without watched names, no `var`, no loose equality, function nesting at most 4, block nesting at most 4, callback nesting at most 2, no snippet nesting deeper than 6 levels, no `eval` or `Function`, assignments only to parameters or non-computed members), `topLevelBoundaries`, the marker snippet sets (table in `design.md`), and a generator for programs with 0 to 3 injected snippets at top-level boundaries
    - Add a guard test that parses every injectable snippet with `acorn`, collects its identifiers, and checks that none matches `^(f|p|m)[0-9]+$`
    - Add the shallow-tree guard test: generate 1,000 programs (with injected snippets), parse them with `acorn`, measure the tree depth with an independent iterative walk, and require a maximum of 40 (more than 7 times below the smallest measured parser nesting limit of 292), and require that no generated line has more than 100 characters. Programs of 1 to 200 lines are therefore never `Stack_Limit_Source`s, so the byte-identical guarantee applies to every property that uses this generator.
    - _Requirements: 11.1, 12.8, 18.3, 18.4, 18.5, 18.6_
  - [x] 8.2 Aggregate the Curse_Corpus
    - Create `test/support/curse-corpus.ts` that exports all `CorpusCase` lists from `test/support/corpus/*.ts` and the self-contained single-statement snippets used for injection
    - _Requirements: 18.1, 18.6_
  - [x] 8.3 Write property test for total function and error shape
    - **Property 1: Total function and error shape**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.7, 3.8, 12.3, 12.5, 12.6, 12.7, 13.15**
    - Create `test/property/total-function.property.test.ts` (strings of 0 to 10,000 characters with lone surrogates, NUL, and `\u2028`; fragments with hashbang, deep nesting, and a marker string; non-string values from `fc.anything()`; all three languages; both functions)
    - This is the one property that feeds near-limit nesting to the scanner. For every input it asserts only totality and error shape: no throw, a plain value, a success value or a Scan_Error with one of the five codes, a message of at most 500 characters, no `curses` or `functions` field on an error, and a marker string never in a Scan_Error message.
    - Assert that `extractFunctionSignatures` returns a Scan_Error equal to the one of `scanCurses` only when a character counter in the test finds a maximum bracket nesting (`(`, `[`, `{`) of at most 100 in the source, far below the 584 bracket levels of 292 nested callbacks, so the equality never depends on stack behavior
    - _Requirements: 12.3, 12.5, 18.2_
  - [x] 8.4 Write property test for determinism, ordering, and shape
    - **Property 2: Determinism, ordering, uniqueness, and serialization shape**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 12.8, 13.17**
    - Create `test/property/determinism.property.test.ts`
    - Generate only programs of 1 to 200 lines from `test/support/clean-corpus.ts` with tree depth at most 40 (guarded by task 8.1). Do not generate inputs whose nesting is near the parser stack limit, because the byte-identical guarantee does not apply to a `Stack_Limit_Source`.
    - _Requirements: 11.1, 12.8, 18.3_
  - [x] 8.5 Write property test for position ranges
    - **Property 3: Positions stay in range**
    - **Validates: Requirements 10.7, 11.7, 13.5**
    - Create `test/property/positions.property.test.ts` (Clean_Corpus programs and programs with injected snippets)
    - _Requirements: 18.4_
  - [x] 8.6 Write property test for Line_Count
    - **Property 4: Line_Count follows the terminator definition**
    - **Validates: Requirements 3.3, 3.9**
    - Create `test/property/line-count.property.test.ts` (whitespace, comments with terminators, and the five terminators in any mix)
  - [x] 8.7 Write property test for line-shift invariance
    - **Property 5: Line-shift invariance**
    - **Validates: Requirements 11.8**
    - Create `test/property/line-shift.property.test.ts` (shifts of 1 to 1,000; programs from the shallow generator of task 8.1)
    - _Requirements: 18.7_
  - [x] 8.8 Write property test for line-ending invariance
    - **Property 6: Line-ending invariance**
    - **Validates: Requirements 11.9**
    - Create `test/property/line-ending.property.test.ts` (programs from the shallow generator of task 8.1)
    - _Requirements: 18.7_
  - [x] 8.9 Write property test for clean programs
    - **Property 8: Clean programs have no findings and no impurity markers**
    - **Validates: Requirements 4.5, 5.5, 5.6, 6.3, 7.4, 7.5, 8.6, 9.5, 13.7, 13.8, 13.9, 13.10, 13.11, 13.12, 13.18**
    - Create `test/property/clean-programs.property.test.ts`
    - _Requirements: 18.5_
  - [x] 8.10 Write property test for injected curses
    - **Property 9: Injected curses are found exactly where they were inserted**
    - **Validates: Requirements 4.1, 4.3, 5.1, 6.1, 7.1, 8.1, 8.2, 8.3, 9.1, 9.2, 11.2**
    - Create `test/property/injection.property.test.ts`; insertion only at top-level statement boundaries
    - _Requirements: 18.6_
  - [x] 8.11 Write property test for texts and severities
    - **Property 10: Texts and severities depend only on the curse type**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.5**
    - Create `test/property/texts.property.test.ts` (identifiers, strings, and comments that contain other curse names and Forbidden_Phrases)
  - [x] 8.12 Write property test for function signature structure
    - **Property 11: Function signature structure**
    - **Validates: Requirements 13.1, 13.2, 13.4, 13.6, 13.13, 13.16**
    - Create `test/property/signature-structure.property.test.ts` with an independent function count from `acorn-walk`
  - [x] 8.13 Write property test for impurity markers
    - **Property 12: Impurity markers follow the injected statement**
    - **Validates: Requirements 13.7, 13.8, 13.9, 13.10, 13.11, 13.12**
    - Create `test/property/impurity-markers.property.test.ts`

- [x] 9. Checkpoint - Scanner core
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. MCP server
  - [x] 10.1 Implement the argument schema and diagnostics
    - Create `src/server/schemas.ts` (`ToolArgs = z.strictObject` with `source` as a string of at most 1,048,576 characters and `sourceLanguage` as the three-value enum) and `src/server/diagnostics.ts` (`logEvent` writes one line to stderr with `process.stderr.write`; `formatToolEvent(tool, result, durationMs)` builds `lazarus-curse-scanner tool=<name> result=<label> durationMs=<n>`; only constant event text, tool name, result label, and duration)
    - _Requirements: 14.3, 14.4, 15.3, 15.5, 15.6_
  - [x] 10.2 Implement the tool handlers and server factory
    - Create `src/server/tools.ts` (`callTool(name, args, deps)`) and `src/server/create-server.ts` (`createServer(version, deps?)` with injectable `scan`, `extract`, and `log`): low-level `Server` with `{ name: 'lazarus-curse-scanner', version }`, `tools/list` with schemas from `z.toJSONSchema` and descriptions of 1 to 500 characters, `tools/call` with an unknown tool as `McpError(InvalidParams, 'Unknown tool')`, one outer `try/catch` returning the constant text `Internal error while handling the tool call.`
    - Validation failure handling: `ToolArgs.safeParse(request.params.arguments)`; on failure return an `isError` result `Invalid arguments: <names>` (up to 20 names, 64 characters each, sorted and de-duplicated; the joined `path` of each issue, each key of an `unrecognized_keys` issue, and `arguments` for an issue with an empty path, which is the absent-`arguments` case). The scanner is not called. `callTool` also accepts `unknown` and gives the same `isError` result for a non-object value as a defensive measure for direct callers.
    - Protocol-level case: the handler does not try to handle a present `arguments` that is not an object. The SDK wrapper rejects it with `InvalidParams` (-32602) before the handler runs, with no scan, and the server stays up. Add no code for it, and verify it in tasks 10.4 and 10.11.
    - Re-read the installed SDK documentation first (open items 1 and 2 of the design), confirm the wrapper behavior above on the installed version, and check whether the SDK accepts the `$schema` key in a tool `inputSchema`
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 14.11, 14.13, 14.14, 15.1, 15.10_
  - [x] 10.3 Implement shutdown and the executable entry point
    - Create `src/server/shutdown.ts` (stdin `end` and `close`, `SIGINT`, `SIGTERM`, idempotent `server.close()`, `process.exitCode = 0`, fail-safe `process.exit(0)` after 4,000 ms) and replace the placeholder `src/index.ts`: read the version with `createRequire(import.meta.url)('../package.json')`, connect `StdioServerTransport`, write the `started` and `stopped` events to stderr, write nothing to stdout itself, read no environment variable
    - Keep `src/lib.ts` free of any import of `src/index.ts`, the SDK, or `zod`
    - _Requirements: 2.2, 2.4, 2.8, 2.9, 14.12, 14.14, 14.15, 15.4, 15.7, 15.8, 15.9_
  - [x] 10.4 Write server unit tests
    - Create `test/unit/server-schemas.test.ts` and `test/unit/server-handlers.test.ts` with an `InMemoryTransport` pair and the SDK client: exactly two tools, descriptions 1 to 500 characters, the input schema has `additionalProperties: false`, both properties required, `maxLength` 1,048,576 and the three-value enum, no property that names a path, URL, or command, `initialize` reports `lazarus-curse-scanner` and the `package.json` version, Scan_Error results carry `isError` and one text item, a source of 1,048,576 non-ASCII characters passes the schema and returns an `INPUT_TOO_LARGE` result, stderr lines contain no source text
    - Validation split (Requirements 14.8 and 15.10): a call with `arguments` absent gives an `isError` result whose text names `arguments`; an object with a wrong type, a value outside the enum, a missing property, or an undeclared property gives an `isError` result that names each invalid property; the scanner stub is never called for these
    - In-memory round trip for non-object `arguments`: through `createServer` and `InMemoryTransport.createLinkedPair()`, send `tools/call` with `arguments` set to a string, an array, `null`, a number, and a boolean, for both tool names, using `client.request` with a cast to bypass the typed `callTool` helper. Each one is rejected with a JSON-RPC `InvalidParams` error (-32602, not an `isError` result), the scanner stub is never called, and the server answers the next valid request. The tests check the error code and not the SDK message text.
    - _Requirements: 14.2, 14.3, 14.4, 14.7, 14.8, 14.14, 15.3, 15.5, 15.6, 15.10_
  - [x] 10.5 Write property test for library and MCP parity
    - **Property 13: Library and MCP parity**
    - **Validates: Requirements 14.5, 14.6, 14.7, 14.11**
    - Create `test/property/mcp-parity.property.test.ts` using `callTool` with the real library, and a smaller round trip through `createServer` with `InMemoryTransport.createLinkedPair()`, with generated programs from `test/support/clean-corpus.ts`
  - [x] 10.6 Write property test for invalid tool arguments
    - **Property 14: Invalid tool arguments are rejected by name before scanning**
    - **Validates: Requirements 14.4, 14.8, 15.10**
    - Create `test/property/mcp-invalid-arguments.property.test.ts` through `callTool` with a stubbed scanner. Scope: `arguments` values that are absent (`undefined`) or objects. The handler accepts exactly an object with a string `source` (at most 1,048,576 characters), a `sourceLanguage` among the three names, and no other property. Every other value gives an `isError` result that names every invalid or unexpected property (`arguments` when absent), the scanner is never called, and no filesystem path is read.
    - A present non-object `arguments` never reaches the handler (the SDK answers `InvalidParams`), so it is not generated here. It is covered by the in-memory round trip of task 10.4 and the raw stdio test of task 10.11.
    - _Requirements: 14.4, 14.8, 15.10, 18.9_
  - [x] 10.7 Write property test for unknown tool names
    - **Property 15: Unknown tool names never reach the scanner**
    - **Validates: Requirements 14.9**
    - Create `test/property/mcp-unknown-tool.property.test.ts`; through `createServer` with `InMemoryTransport` and a stubbed scanner, the server answers with a JSON-RPC error that does not contain the name, never calls the scanner, and handles the next request
  - [x] 10.8 Write property test for exceptions
    - **Property 16: Exceptions become a constant result**
    - **Validates: Requirements 14.10**
    - Create `test/property/mcp-exceptions.property.test.ts`; an injected scanner that throws with generated messages (including the source text) always yields the same constant 44-character `isError` text, with no part of the source or of the exception
  - [x] 10.9 Write property test for diagnostic lines
    - **Property 17: Diagnostic lines contain only constant fields**
    - **Validates: Requirements 15.5**
    - Create `test/property/mcp-diagnostics.property.test.ts` for `formatToolEvent` over tool names, result labels, and non-negative integer durations
  - [x] 10.10 Write the SDK client integration test
    - Create `test/integration/stdio-sdk-client.test.ts`: start `dist/index.js` with `StdioClientTransport` (`process.execPath`, `cwd` at the workspace root, `stderr: 'pipe'`, `NODE_ENV=development`), list tools, call both tools with valid arguments, with arguments that fail the schema (an object with a wrong type, a value outside the enum, an undeclared property, and absent `arguments`, each as an `isError` result), a source with a syntax error, and an unknown tool name; close the client in `afterAll`; 30,000 ms limit; paths through `fileURLToPath`
    - Do not send a non-object `arguments` through the SDK client, because `Client.callTool` is typed to take a record and whether it rejects other values before sending is SDK behavior the test must not depend on. Task 10.11 sends them as raw JSON-RPC.
    - A missing `dist/index.js` fails the test with the message `dist/index.js is missing. Run: pnpm exec turbo run build --filter=@lazarus/mcp-curse-scanner`; it never skips
    - _Requirements: 2.2, 14.5, 14.6, 14.7, 14.8, 14.9, 18.9_
  - [x] 10.11 Write the raw stdio integration test
    - Create `test/integration/stdio-raw.test.ts` with `child_process.spawn(process.execPath, [distEntry], { cwd: workspaceRoot, env })`, with `env` built from the SDK helper `getDefaultEnvironment()` plus `NODE_ENV`, and write JSON-RPC by hand to capture raw stdout and stderr bytes. Assert: stdout is empty before the first request, every stdout line is one complete JSON-RPC 2.0 message, a unique marker in a scanned source and in an invalid argument value appears only inside the matching response and never in stderr, the process exits with code 0 within 5,000 ms after stdin closes, and it is still running 2,000 ms after launch with no module resolution error
    - Non-object `arguments`: after `initialize` and `notifications/initialized`, write raw `tools/call` requests with a distinct `id` each, for both tool names, and with `arguments` set to a string (`"x"`), an array (`[]`), `null`, a number (`1`), and a boolean (`true`). For each one, read the response with the same `id` and assert that it has an `error` member with `code` -32602 and no `result` member, that no scan marker appears in stdout outside that response, and that stderr gets no line for that call. After the series, send a valid `tools/call` and assert a normal non-error result, which proves the server stayed up.
    - Absent `arguments`: send a `tools/call` without `arguments` and assert no `error` member, `result.isError` true, and a text that names `arguments`
    - _Requirements: 2.2, 2.8, 2.9, 14.8, 14.12, 14.15, 15.4, 15.6, 15.7, 15.10, 18.9, 18.10_
  - [x] 10.12 Write the Registration compatibility test
    - Create `test/integration/registration.test.ts`: read `.kiro/settings/mcp.json` (read only), check `command`, `args`, and that `autoApprove` equals the `tools/list` names as an unordered set; run the Registration command line with the workspace root as working directory and `NODE_ENV=development` and receive the `initialize` response within 10,000 ms; identical tool results for `NODE_ENV` unset, `development`, `production`, and `test`
    - _Requirements: 15.9, 16.1, 16.2, 16.3_
  - [x] 10.13 Write the cross-process determinism test
    - Create `test/integration/cross-process.test.ts`: run the same scans in two separate child processes with different `TZ` and `LANG` values (through `env`) and compare the JSON text byte for byte. Inputs: the Curse_Corpus snippets, the three `legacy.js` seed files (read as text through the seed loader of task 12.1), one fixed Clean_Corpus program of 200 lines, one source with a syntax error, one source for `INPUT_TOO_LARGE`, and the flat 200,001-node source (which gives `LIMIT_EXCEEDED` from the node count and not from the stack).
    - Keep every input away from any `Stack_Limit_Source`: a guard assertion in the test measures the maximum syntax-tree depth of each input that parses with the independent iterative walk and requires at most 40. Use none of the nesting shapes of task 5.7, and do not provoke `TIMEOUT`.
    - _Requirements: 11.1, 11.6, 12.8_
  - [x] 10.14 Write the scanner source scan test
    - Create `test/unit/source-scan.test.ts`: parse `src/**/*.ts` with the TypeScript API and fail with the file name and item for any import or `require` (static or dynamic, with or without `node:`) of `vm`, `child_process`, `worker_threads`, `fs`, `net`, `http`, `https`, `dgram`, or `dns`, any call of `eval`, `new Function`, or `Function(...)`, any `console.*`, any `process.env`, any `fetch`, any import of a database or LLM module, and any write to `.kiro/settings`
    - _Requirements: 3.10, 15.1, 15.2, 15.8, 16.3, 18.11, 20.3, 20.4, 20.5_

- [x] 11. Checkpoint - MCP server
  - Run the package build first (`pnpm exec turbo run build --filter=@lazarus/mcp-curse-scanner`), then the package tests, so the integration tests find `dist/index.js`.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Agreement tests with the seed data
  - [x] 12.1 Implement the seed loader and the mismatch message builder
    - Create `test/support/seed-loader.ts`: `loadSeedSamples(seedDir)` never throws and returns `{ samples, problems }`. The default seed directory is `fileURLToPath(new URL('../../../../db/seed/', import.meta.url))`.
    - Discover only the immediate subdirectories of `db/seed/` (so `generate-seed.ts` is ignored), sorted by name. Read only `legacy.js` and `sample.json` with `readFileSync(…, 'utf8')`. Replace every CR LF in `legacy.js` with LF before use. Do not read `modern.ts` or `test-code.js`, and do not import or execute any file under `db/`.
    - Validate `sample.json` in this order: valid JSON; `sourceLanguage` is one of the three values; `entryFunction` is a non-empty string; `curses` is an array with at least one entry; for each entry `type` is a Curse_Type, `severity` is a Severity, `match` is a non-empty string that occurs in `legacy.js`
    - `seededLineOf(legacy, match)` repeats the rule of `db/seed/generate-seed.ts`: `legacy.split('\n').findIndex((line) => line.includes(match)) + 1`, or `null` when `match` does not occur. Read `generate-seed.ts` first to confirm the rule is unchanged.
    - Every problem message starts with `Foundation_Spec prerequisite not met:` and uses paths relative to the Workspace_Root with forward slashes, with the messages of the design table (missing `db/seed/`, no Sample_Source subdirectory, missing `legacy.js` or `sample.json`, invalid JSON, invalid field such as `curses[2].match`, `match` absent from `legacy.js`)
    - Create `test/support/seed-mismatch.ts` with the pure function `describeMismatch(folder, curse, findings)` that names the Sample_Source, the Curse_Type, the Seeded_Line, the `match` text, and the `lineNumber` values of the findings of that Curse_Type that the scanner returned (or `none`), and a variant for the Entry_Function that names the folder, the function name, and the number of signatures found
    - _Requirements: 17.1, 17.7, 17.8, 17.9, 17.10_
  - [x] 12.2 Write seed loader unit tests
    - Create `test/unit/seed-loader.test.ts` with temporary directories from `fs.mkdtempSync`: one case per problem row (missing seed directory, empty seed directory, missing `legacy.js`, missing `sample.json`, invalid JSON, each invalid field, `match` absent), CR LF normalization, the Seeded_Line rule (first matching line, 1-based), a file `generate-seed.ts` next to the directories is ignored; a unit test of `describeMismatch` with fake results, including the `none` case
    - Add one test that runs `loadSeedSamples` on the real `db/seed/` and expects no problems and the three samples `batch-calculator`, `invoice-totals`, and `query-string-parser`
    - _Requirements: 17.1, 17.7, 17.8, 17.9_
  - [x] 12.3 Write the seed agreement tests
    - Create `test/agreement/seed-agreement.test.ts`: call `loadSeedSamples` once at collection time. If `problems` is not empty, register one test named `R17.7 R17.8 seed prerequisites are met` that throws the joined problem list, so the run ends failed (never skipped, never passed). Samples without problems still get their per-sample tests.
    - Per Sample_Source (`invoice-totals` with `es3`, `query-string-parser` with `es5-jquery`, `batch-calculator` with `legacy-node`, found by discovery and not hard-coded): `scanCurses` returns `ok: true`; for each Seeded_Curse at least one finding with the same `curseType` and `lineNumber` equal to the Seeded_Line; every such finding has the seeded `severity`; the test never asserts the number of findings; `extractFunctionSignatures` returns a success value with exactly one signature whose `name` equals `entryFunction`, with `nestingDepth` 0 and `kind` `declaration`
    - A failing assertion uses `describeMismatch` for its message
    - _Requirements: 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9_
  - [x] 12.4 Write the db-untouched test
    - Create `test/agreement/db-untouched.test.ts`: compute a SHA-256 of every file under `db/` in `beforeAll` (before the agreement tests run) and compare in `afterAll`; assert that the agreement run opens no database connection and reads no environment variable
    - _Requirements: 17.10, 20.2, 20.3_
  - [x] 12.5 Write the agreement files scan
    - Create `test/unit/agreement-scan.test.ts`: parse every file under `test/agreement/` and `test/support/` with the TypeScript API and fail with the file name when it imports a module whose resolved path is inside `db/`, imports `child_process`, a database module, or a network module, or reads `process.env`
    - _Requirements: 17.10, 20.3, 20.4_

- [x] 13. Packaging tests
  - [x] 13.1 Write the packaging smoke tests
    - Create `test/integration/packaging.test.ts`: after the build, every file referenced by `exports` exists; no import specifier in `dist/` resolves outside the package and no file in `dist/` mentions `db/`, `scripts/`, or `.kiro/`; every `.js` file in `dist/` is ESM and `package.json` declares `"type": "module"`; importing `dist/lib.js` in a child process writes 0 bytes to stdout and stderr and starts no server; `git check-ignore` exits 0 for `packages/mcp-curse-scanner/dist`; `tsc --showConfig -p tsconfig.json` shows `"strict": true`; an ESLint API run on a string with an explicit `any` reports `@typescript-eslint/no-explicit-any`; the package `turbo.json` has `test.dependsOn` containing `build`, `cache: true`, and the two seed globs; `package.json` lists every third-party import of `src/` and `test/`
    - _Requirements: 1.6, 1.7, 1.9, 2.3, 2.4, 2.5, 2.6, 2.7, 18.12, 18.13_

- [x] 14. Documentation and conventions
  - [x] 14.1 Write the README
    - Create `packages/mcp-curse-scanner/README.md` with the level-2 headings `Overview`, `Build and test`, `Library usage`, `Detection rules`, `Result and error formats`, `Limits`, `MCP tools`, and `Enabling the MCP server in Kiro`, in this order
    - `Overview` states in 1 to 5 sentences what the package does and that findings are static heuristics that can miss or over-report constructs; `Build and test` lists the commands run from the Workspace_Root through Turborepo (`pnpm exec turbo run build lint test --filter=@lazarus/mcp-curse-scanner`), because `test` needs `build` first; `Library usage` has one `scanCurses` example and one `extractFunctionSignatures` example, each with the import, the call, and `ok: false` handling; `Detection rules` is a six-row table (Curse_Type, Severity) in Curse_Type_Order; `Result and error formats` lists the fields of a success result, a Curse_Finding, and a Scan_Error and the five codes; `Limits` lists all four numeric limits; `MCP tools` lists both tools with input schema and output format
    - State that `pureCandidate` is a static heuristic that does not prove purity or determinism
    - The last section has three numbered steps (`pnpm build`, change `"disabled": true` to `"disabled": false` for `lazarus-curse-scanner` in `.kiro/settings/mcp.json`, reload the MCP servers in Kiro) and states that the Registration stays disabled until `packages/mcp-curse-scanner/dist/index.js` exists
    - No Forbidden_Phrase anywhere in the file
    - _Requirements: 13.14, 16.4, 16.5, 19.1, 19.2, 19.3, 19.4, 19.5, 19.6_
  - [x] 14.2 Write the README test
    - Create `test/unit/readme.test.ts`: heading titles and order, the six-row table matches the severity mapping, the five Scan_Error codes, the numeric limits equal `LIMITS`, three enablement steps in order, the disabled-until-built statement, the `pureCandidate` statement, no Forbidden_Phrase, and the code examples compile against the emitted declarations of `dist/` (use the TypeScript API in memory)
    - _Requirements: 13.14, 16.4, 16.5, 19.1, 19.2, 19.3, 19.5, 19.7_
  - [x] 14.3 Write the test conventions scan
    - Create `test/unit/test-conventions.test.ts`: every test title in `test/**/*.test.ts` starts with `R<number>.<number>`; every file that calls `fc.assert` carries a comment `Feature: 02-scanner-and-verifier, Property <n>: <title>` (or `Supporting check: <title>` for checks without a design property number); each property number from 1 to 17 appears exactly once
    - _Requirements: 18.14_

- [x] 15. Final checkpoint - Ensure all tests pass
  - Run `pnpm build`, `pnpm lint`, and `pnpm test` from the repository root (or `pnpm exec turbo run build lint test --filter=@lazarus/mcp-curse-scanner`). Confirm with `git status` that this plan created or changed no file outside `packages/mcp-curse-scanner` and `pnpm-lock.yaml`, and that `db/`, `scripts/`, `apps/web`, `packages/pbt-verifier`, and `.kiro/settings/` are unchanged by it.
  - Ensure all tests pass, ask the user if questions arise.
  - Manual steps for the user, not performed by the agent:
    - Install Node 24 and `pnpm` if the machine does not have them, then run `pnpm install`.
    - Run the build with `pnpm build` or `pnpm exec turbo run build --filter=@lazarus/mcp-curse-scanner`.
    - Change `"disabled": true` to `"disabled": false` for `lazarus-curse-scanner` in `.kiro/settings/mcp.json` (the agent cannot edit that file).
    - Reload the MCP servers in Kiro.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Every other test task is part of the deliverable.
- Each task references specific requirements for traceability. Property tasks name the property from `design.md` and the requirements it validates.
- Checkpoints give the user a place to review before the next layer starts.
- The agreement tests (task 12) fail, and do not skip, when `db/seed/` or any field they read is missing. They read the three sample directories as text and import or execute nothing under `db/`, and they depend on the seed files as they exist now.
- The four earlier open questions are decided (see "Decisions taken" in the Overview); no decision is pending.
- Re-check the library APIs against the installed versions for the items in "To re-verify at implementation time" of `design.md` (MCP SDK, `zod`, Turborepo, `acorn` including `checkUnreserved`, Windows spawn).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.5", "4.1", "4.2"] },
    { "id": 4, "tasks": ["3.4", "3.6", "4.3", "4.6", "5.1"] },
    { "id": 5, "tasks": ["4.4", "4.5", "5.2", "5.3", "5.5", "5.7"] },
    { "id": 6, "tasks": ["5.4", "5.6", "5.8", "5.9"] },
    { "id": 7, "tasks": ["5.10", "5.11", "6.1", "6.2", "7.1"] },
    { "id": 8, "tasks": ["6.3", "6.4", "7.3"] },
    { "id": 9, "tasks": ["6.5", "6.6"] },
    { "id": 10, "tasks": ["6.7", "6.8"] },
    { "id": 11, "tasks": ["6.9", "6.10"] },
    { "id": 12, "tasks": ["6.11", "6.12"] },
    { "id": 13, "tasks": ["6.13", "7.2"] },
    { "id": 14, "tasks": ["7.4", "8.1", "8.2", "8.3", "8.6"] },
    { "id": 15, "tasks": ["8.4", "8.5", "8.7", "8.8", "8.9", "8.10", "8.11", "8.12", "8.13"] },
    { "id": 16, "tasks": ["10.1", "12.1"] },
    { "id": 17, "tasks": ["10.2", "12.2", "12.3", "12.4"] },
    { "id": 18, "tasks": ["10.3", "10.4", "10.5", "10.6", "10.7", "10.8", "10.9", "12.5"] },
    { "id": 19, "tasks": ["10.10", "10.11", "10.12", "10.13", "10.14", "13.1"] },
    { "id": 20, "tasks": ["14.1"] },
    { "id": 21, "tasks": ["14.2"] },
    { "id": 22, "tasks": ["14.3"] }
  ]
}
```
