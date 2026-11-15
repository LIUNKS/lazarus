# @lazarus/sandbox-runner

## Overview

This package runs user-imported legacy JavaScript, its generated TypeScript counterpart, and the generated test code inside a layered isolation environment, so that live property-based testing can be offered to signed-in users. It is a library with no HTTP surface, no database access, and no environment variables.

It is defense in depth with stated limits. It is not a claim that hostile code cannot escape. Each run gets a fresh Worker thread, fresh `node:vm` contexts inside that Worker, memory and time limits, an empty environment, and no host object within reach of the code. The Worker is a thread of the same operating-system process as the web server. Read the [Threat model](#threat-model) before you enable user-code execution.

Results are empirical evidence: they say that two functions agreed, or disagreed, on a stated number of generated inputs.

## Usage

Build the package before use. The Workers load their files from `dist/worker/`.

```bash
pnpm exec turbo run build lint test --filter=@lazarus/sandbox-runner
```

### `verifyLive`

`verifyLive` is the entry point for a Route Handler. The gate decides first, and a denied request touches no code.

```ts
import { createLiveExecutionGate, verifyLive } from '@lazarus/sandbox-runner';

// One gate per process. User-code execution is off unless `userExecutionEnabled` is true.
const gate = createLiveExecutionGate({ userExecutionEnabled: false });

const result = await verifyLive(
  {
    origin: 'user', // from the `is_sample` column of a row loaded under RLS, never from the request body
    caller: { kind: 'member', userId },
    corpusOwnerId, // from the `user_id` column of the same row
    legacyCode,
    modernCode,
    entryFunction: 'computeTotal',
    testCode, // the stored `pbt_test_code`
    numRuns: 1000,
  },
  gate,
);

if (result.status === 'ERROR') {
  // result.code, result.message, and result.reason when the code is LIVE_EXECUTION_DENIED
} else {
  // PASSED or FAILED: result.evidence, result.totalRuns, result.seed, result.counterexample
}
```

### Property mode

`runSandboxedVerification` runs the stored test code with `fast-check` entirely inside the Sandbox. It applies no gate, so call it only for code you are allowed to run.

```ts
import { runSandboxedVerification } from '@lazarus/sandbox-runner';

const result = await runSandboxedVerification({
  legacyCode: 'function double(a) { return a * 2; }',
  modernCode: 'export function double(a: number): number { return a + a; }',
  entryFunction: 'double',
  testCode: 'return fc.property(fc.integer(), function (n) { assertEquivalent(n); });',
  numRuns: 1000,
  seed: 42,
});

if (result.status === 'ERROR') {
  // for example SANDBOX_TIMEOUT or MODERN_COMPILE_ERROR
} else {
  // result.evidence is "Verified behavioral equivalence across 1,000 generated inputs (seed 42)."
}
```

The test code follows the contract of `database-and-exorcism.md` without extension: it is the body of a function with the parameters `fc`, `legacyFn`, `modernFn`, `assertEquivalent`, and `numRuns`, and it ends with `return fc.property(...)`. It controls neither the run count nor the seed. An async property is supported only when it settles by microtasks.

### Cases mode

`runSandboxedCases` runs both functions on explicit inputs and returns one outcome per input. A list of cases is not a verification, so this result has no evidence text.

```ts
import { runSandboxedCases } from '@lazarus/sandbox-runner';

const result = await runSandboxedCases({
  legacyCode: 'function double(a) { return a * 2; }',
  modernCode: 'export function double(a: number): number { return a + a; }',
  entryFunction: 'double',
  inputs: [1, 2.5, 'text'],
});

if (result.status === 'ERROR') {
  // for example UNSUPPORTED_VALUE for an input that holds a function
} else {
  // result.cases[i] is { equivalent, legacy, modern } for inputs[i]
}
```

Each case gets its own copy of the input. The two contexts live for the whole run, so a function that keeps state in module-level variables can return a value that depends on earlier cases.

None of the exported functions throws or rejects. Every outcome is a result object.

## Gate and defaults

| `GateConfig` field | Default | Meaning |
|---|---|---|
| `userExecutionEnabled` | `false` | User-code execution is off by default. Set this field to `true` to allow it. |
| `allowAnonymousSampleRuns` | `false` | Anonymous visitors see precomputed sample results only. |
| `perUserConcurrency` | `1` | Runs of one user at the same time. |
| `globalConcurrency` | `4` | Runs of all users at the same time. |

Decision rules, in order: a malformed request is denied with `INVALID_REQUEST`; a sample corpus runs in-process for a member (and for an anonymous caller only when `allowAnonymousSampleRuns` is true, otherwise `ANONYMOUS_NOT_ALLOWED`); a user corpus needs a member (`AUTH_REQUIRED`), `userExecutionEnabled` (`USER_EXECUTION_DISABLED`), and the member must own the corpus (`NOT_OWNER`); then the concurrency limits apply (`USER_CONCURRENCY_LIMIT`, `GLOBAL_CONCURRENCY_LIMIT`). An anonymous caller is never allowed to run user code, whatever the configuration.

The gate reads no environment variable. The caller maps its own switch to `userExecutionEnabled`.

The concurrency limits are per process. The counters live in the memory of the process that created the gate, so a deployment with several server instances multiplies the limits. Time-window quotas are not part of this package.

When the Sandbox cannot start, for example because the worker files are missing, the result is `SANDBOX_UNAVAILABLE`. A user corpus never falls back to in-process execution.

## Limits

Every limit is an optional integer in `options.limits`. A value outside its range returns `INVALID_OPTIONS` before any Worker is created.

| Limit | Default | Range | What it bounds |
|---|---|---|---|
| `wallClockTimeoutMs` | 10000 | 100 to 60000 | The whole run inside the Worker. The host stops the Worker 2000 ms later at the latest. |
| `caseTimeoutMs` | 1000 | 1 to 10000 | One side of one case in cases mode. |
| `compileTimeoutMs` | 10000 | 1000 to 30000 | Type-checking and transpiling the modern code. |
| `maxOldGenerationSizeMb` | 128 | 32 to 512 | Heap of the Worker that runs the code. |
| `maxYoungGenerationSizeMb` | 16 | 8 to 64 | Young generation of that heap. |
| `maxExternalMemoryMb` | 256 | 16 to 1024 | Memory outside the heap, such as `ArrayBuffer` contents. Polled every 100 ms, best effort. |
| `maxValueBytes` | 65536 | 1024 to 262144 | One encoded input or outcome. |
| `maxResultBytes` | 524288 | 4096 to 2097152 | The result text of a run, and the combined inputs of cases mode. |
| `maxSourceBytes` | 262144 | 1024 to 1048576 | Each code string, in UTF-8 bytes. |

`numRuns` is an integer from 100 to 1000 (default 1000). `seed` is a 32-bit signed integer (default: the current time). `allowDynamicCode` (default `false`) allows `eval` and `Function` inside the contexts; the isolation does not depend on it.

## Supported and rejected values

Values cross the isolation boundary only as text, in one deterministic format. Two returned values are equivalent exactly when their texts are equal, which implements the comparison rules of `database-and-exorcism.md`: `NaN` equals `NaN`, `+0` differs from `-0`, structures are compared without their prototypes, and two thrown values are equivalent when their `name` is equal.

**Supported:** `undefined`, `null`, booleans, numbers (including `NaN`, the infinities, and `-0`), strings, bigints, arrays (including holes), plain objects (own enumerable string keys), `Date` (including the invalid date), `RegExp`, `Map`, `Set`, `Error` objects (name and message), and typed arrays. A class instance is encoded as a plain object.

**Rejected in inputs** with `UNSUPPORTED_VALUE` and the path of the value: functions, symbols, `WeakMap`, `Promise`, host-only objects such as `URL`, and a function or symbol under a symbol key. Other symbol keys are ignored.

**Cycles and shared references:**

- A cyclic input is rejected with the message `cyclic input`.
- An input that holds the same object twice, without a cycle, is written in full at each place. Sharing is not preserved, and each copy is independent.
- A returned value with a cycle is written with a back-reference to its ancestor, so two structurally equal cyclic values compare as equal.
- A returned function or symbol is written as a marker that carries no data: two functions compare as equal, whatever their bodies.

Only synchronous functions are supported. A returned `Promise` is treated as a plain object and is not awaited.

## Error codes

An `ERROR` result has a `code`, an English `message` of at most 500 characters, and never a stack trace, a host path, or source text.

| Code | Meaning |
|---|---|
| `LIVE_EXECUTION_DENIED` | The gate denied the run. `reason` says why. No code was touched. |
| `SANDBOX_UNAVAILABLE` | The worker files could not be loaded. |
| `INVALID_OPTIONS` | An option or a limit is invalid, or a code string is too large. |
| `UNSUPPORTED_VALUE` | A value cannot cross the isolation boundary. |
| `MODERN_COMPILE_ERROR` | The modern code has a type error or an import. |
| `LEGACY_LOAD_ERROR` / `MODERN_LOAD_ERROR` | The code has a syntax error or threw while loading. |
| `ENTRY_FUNCTION_NOT_FOUND` | The entry function is missing on the side the message names. |
| `TEST_CODE_ERROR` | The test code does not compile, threw, or did not return a property. |
| `SANDBOX_TIMEOUT` | The run, one case, or the compile stage exceeded its time limit. |
| `SANDBOX_OUT_OF_MEMORY` | The Worker reached its heap limit or the external-memory limit. |
| `SANDBOX_FORBIDDEN_CAPABILITY` | The code tried something the Sandbox denies. Best-effort report, never a security decision. |
| `OUTPUT_LIMIT_EXCEEDED` | A value or the result is larger or deeper than its limit. |
| `SANDBOX_CRASH` | The Worker ended without a valid result. |
| `INTERNAL_ERROR` | An unexpected failure of the host code. |

## Threat model

### Assets

The server process: its files, its environment secrets (such as the service role key and the database credentials), and its network position. The data of other users. The availability of the service.

### Attacker

A signed-in user who imports legacy JavaScript, or who controls the content from which a language model generates TypeScript and test code (prompt injection). The attacker can run arbitrary JavaScript inside the Sandbox. The attacker cannot change the host code or the trusted scripts.

### Layers and what each one addresses

| Layer | Addresses |
|---|---|
| Gate: origin, sign-in, ownership, off by default, concurrency limits | Accidental or anonymous execution, and many parallel runs of one user |
| A fresh Worker per run, terminated on every path | State that leaks between runs, and runaway threads |
| Heap limits, a host kill timer, and a `vm` timeout that also covers microtasks | Heap bombs, infinite loops, and regular-expression backtracking |
| An empty Worker environment, captured output streams, primitive-only Worker data | Environment variables reachable through the Worker, and output flooding |
| Fresh contexts with an ordinary global object, no value of the Worker's realm inside, trusted helpers evaluated inside | Reaching `process`, `require`, or file and network modules through the `constructor.constructor` route |
| A strict-mode bootstrap and a locked `Error.prepareStackTrace` | The call-site route to host functions |
| Dynamic code generation and WebAssembly compilation disabled by default, no module loader | Code and modules loaded from strings |
| The text codec, size and depth caps, and a validated result shape | Oversized or malformed results, and getter or prototype tricks at the boundary |
| A separate Worker for compilation, with a timeout and a memory limit | A type-check built to take very long |
| Bounded results with banned phrases redacted | Leaking paths, stack traces, and source text |

### What the Sandbox does not protect against

1. **Engine and Node.js vulnerabilities.** The Sandbox runs in the same operating-system process as the web server. The Node.js documentation says that `node:vm` is not a security mechanism, and a Worker thread is not an operating-system sandbox. A bug in V8 or in Node.js that breaks context isolation gives the attacker the privileges of the server process: its files, its network, and its environment. The empty Worker environment hides only the Worker's own copy.
2. **Side channels.** Timing, CPU contention, and cache effects between the Sandbox and the server are not mitigated. Removing `SharedArrayBuffer` and `Atomics` takes away one timer source only.
3. **Resource exhaustion that outpaces the controls.** Memory outside the heap is polled every 100 ms, so a fast allocation burst can pass the limit before the poll sees it. CPU use by up to `globalConcurrency` busy Workers is allowed. A process-wide out-of-memory condition can still end the process.
4. **Forging of the verdict by the author of the code.** Hostile code shares a context with `fast-check` and the driver. It can find the entry-point names, which are random but not secret, and it can make its own run report a pass. A verdict is evidence about the behavior the author chose to show. It is visible only to the owner of the corpus and is not an attestation.
5. **Denial of service by many requests.** The gate limits concurrency per process. Time-window quotas belong to the HTTP layer (`08-live-verification-api`), not to this package.
6. **Limits of the Node.js permission model.** This design does not use it. In Node.js 24 it has no network scope, and its documentation says that it does not inherit to Worker threads.
7. **Native addons and other hosts.** A native addon loaded by the server is outside this analysis. Behavior on operating systems or Node.js versions other than the tested ones is not assessed.
8. **Prompt injection itself.** The Sandbox contains the effects when generated code runs. It does not prevent bad generation.

### Recommended hardening before wider exposure

Apply these before the feature is offered beyond a small trusted audience. Keep `userExecutionEnabled` off until then.

1. Run the Sandbox in a separate operating-system process or container with no application secrets in its environment, a read-only filesystem, no network namespace, CPU and memory cgroup limits, and a non-root user.
2. Prefer a microVM or an external execution service when the users are not trusted.
3. Start the process that hosts the Sandbox with the Node.js `--permission` flag and the narrowest file-system and Worker grants.
4. Log every run on the server: user, corpus, result code, and duration.

The supervisor (`src/host/supervisor.ts`) is the single place that creates a Worker, so replacing the Worker with a process, a container, or a remote service changes one module.

## Escape classes the tests do not cover

The adversarial corpus (`test/corpus/hostile.ts`) attacks the Sandbox with infinite loops, memory bombs, oversized results, attempts to reach `process`, `require`, `fetch`, timers, `eval`, and `import()`, the `constructor.constructor` route, intrinsic tampering, a stack-trace call-site attack, and input mutation. A passing run shows that these attacks fail on the tested Node.js version and operating system. It does not show that no escape exists.

The tests do not cover:

- engine-level vulnerabilities in V8 or Node.js;
- escapes that depend on a specific Node.js or V8 patch version;
- native addons;
- side channels;
- rapid external-memory exhaustion between two polls;
- behavior under many concurrent Workers;
- behavior on operating systems other than the one the tests ran on;
- attacks on the build or on the bundled copy of `fast-check`.

## Verified facts and open items

The facts this design relies on, with their sources, are listed under "Verified facts" in `.kiro/specs/07-sandboxed-execution/design.md`. The open items of that document (O1 to O7) were checked during implementation; the results are recorded in the task notes of `.kiro/specs/07-sandboxed-execution/tasks.md`. Three of them differ from what the design assumed:

- The external-memory check reads the Worker's own heap statistics. The host value named in the design does not include the memory of a Worker.
- A fresh context carries a `console` object, which the trusted scripts remove together with `SharedArrayBuffer` and `Atomics`.
- The bundled `fast-check` reads two timer names when it loads. The build declares them as locals of the bundle, so no context defines a timer.

Decisions that stay with the operator: the gate defaults, whether dynamic code generation is allowed, the limit values for the target host, and the fact that the concurrency limits apply per process.
