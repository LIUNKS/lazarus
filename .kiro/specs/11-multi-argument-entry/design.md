# Design Document

## Overview

Three places change, in dependency order:

1. **Verifier** (`packages/pbt-verifier`): a spreading call into a sandbox, the helper `assertEquivalentArgs`, and a guard on `assertEquivalent` that reads the Declared_Arity of Legacy_Fn.
2. **Sandbox_Runner** (`packages/sandbox-runner`): the same helper and guard in the Driver_Context, and an `apply` operation and an `arity` operation in the Side_Adapter.
3. **Web app** (`apps/web`): the prompt carries the Entry_Params, the instructions describe the two helpers, and the Static_Gate checks which helper a Multi_Parameter test uses.

The verify route of `08-live-verification-api` does not change. A stored one-argument test of a Multi_Parameter function now ends with `TEST_CODE_ERROR`, which that route already classifies as inconclusive: nothing is stored and the corpse status stays as it was.

## Why a second helper and not a flag

The alternative was a run option (for example `spread: true`) chosen by the server from the Entry_Params. It was rejected because the stored `pbt_test_code` would no longer say how it calls the function, and every caller (the verify route, a maintainer reproducing a run) would have to recompute the option. With a named helper the stored body is self-describing, and the Runner can check its use against the function it loaded.

## Declared_Arity

The Runner reads the own property `length` of Legacy_Fn as a data descriptor. An accessor, a missing property, or a value that is not a non-negative integer counts as 0. The legacy code can redefine `length`. That only lets it change the verdict of its own run, which the Threat_Model of `07-sandboxed-execution` already accepts for code under test.

- Verifier: read on the host side with `Reflect.getOwnPropertyDescriptor`. The Verifier runs only `sample` code, so a Proxy trap on the function is not a concern there.
- Sandbox_Runner: read inside the Side_Adapter when the Entry_Function is bound, with the prelude's captured `ReflectGetOwnPropertyDescriptor`, and exposed as the operation `arity`. The Driver_Context asks for it once, before the Test_Code is built.

## Verifier changes

| File | Change |
|---|---|
| `src/sandbox/context.ts` | `Sandbox.invoke(fn, input, timeoutMs, spread = false)`. With `spread`, a second fixed script calls `apply(fn, undefined, input)`, where `apply` is the context's `Reflect.apply` captured when the sandbox is created and set into a slot for each call, like the function and the input. |
| `src/run/sides.ts` | `Side.outcome(input, spread?)` passes `spread` on. New `createAssertEquivalentArgs(legacy, modern, state)`: `Array.isArray(args)` or a thrown `CallStyleError`; then the same comparison as `createAssertEquivalent`. `createAssertEquivalent` gets an optional `declaredArity`; with 2 or more it throws `CallStyleError` before any call. |
| `src/run/run-state.ts` | New `CallStyleError` (name `CallStyleError`). |
| `src/run/execute.ts` | A `CallStyleError` cause gives `TEST_CODE_ERROR` with its own message, checked before the generic branch and after the difference branch. |
| `src/run/prepare.ts` | `PreparedSides` gains `assertEquivalentArgs` and `declaredArity`. |
| `src/verify-test-code.ts` | Six parameters; passes the guarded `assertEquivalent` and `assertEquivalentArgs`. |

`verifyEquivalence` (the mode with an `inputArbitrary` instead of Test_Code) keeps its unguarded one-argument call: it is not in the scope of Requirement 2, and no caller uses it with a Multi_Parameter function.

## Sandbox_Runner changes

| File | Change |
|---|---|
| `src/worker/scripts/prelude.js` | `var ReflectApply = Reflect.apply;` |
| `src/worker/scripts/side.js` | `callEntry(inputText, spread)`: with `spread`, the decoded input must be an array (otherwise a `{"k":"x"}` failure with `TEST_CODE_ERROR`) and the call is `ReflectApply(entryFunction, undefined, input)`. Operations `apply` and `arity`; `bind` records the Declared_Arity. |
| `src/worker/scripts/driver.js` | `callSide(api, side, inputText, operation)`. `assertEquivalentArgs(args)` checks `ArrayIsArray` and aborts with `TEST_CODE_ERROR`, then compares like `assertEquivalent`. `assertEquivalent` aborts with `TEST_CODE_ERROR` when the legacy Declared_Arity is 2 or more. `build` gets the sixth argument. |
| `src/worker/exec-entry.ts` | The parameter list of the Test_Code gets `assertEquivalentArgs`. |

`abort` records the first harness failure, so the classification returns `TEST_CODE_ERROR` with the message even though `fast-check` caught the throw.

## Web app changes

| File | Owner | Change |
|---|---|---|
| `src/lib/pipeline/prompts.ts` | 05 | `ReincarnatePromptInput.entryParams: readonly string[] \| null`; one JSON line before the untrusted blocks. New instruction lines (the existing sentence about five parameters stays word for word, because `prompts.fixed-text.test.ts` pins it). Hint for `TEST_ASSERT_EQUIVALENT_ARGS`. |
| `src/lib/pipeline/static-gate.ts` | 05 | `GateRule` and `RULE_ORDER` gain `TEST_ASSERT_EQUIVALENT_ARGS` after `TEST_ASSERT_EQUIVALENT`. `GateOptions.entryParamCount?: number`. The test wrapper head lists six parameters. The analysis records references to both helpers. |
| `src/lib/pipeline/routes/reincarnate.ts` | 05 | Takes the Entry_Params from `eligibility.candidates` by the entry function name and passes them to the prompt and their count to the gate. |
| `src/lib/testing/harness.ts` | 05 | The shared fixture `validReincarnationOutput()` tests `calc(a, b)`, a two-parameter function, with `assertEquivalent(input)`: the exact case of this spec. It now calls `assertEquivalentArgs(args)`. |
| `src/lib/pipeline/prompts.fixed-text.test.ts` | 05 | The list of rules that must have a retry hint gains `TEST_ASSERT_EQUIVALENT_ARGS`. |

## Correctness properties

1. **Spread equivalence.** For any array of 2 to 4 integers, a legacy and a modern function that return the same function of all their parameters pass under `assertEquivalentArgs`, in both Runners. _Validates 1.2_
2. **Every parameter counts.** For a modern function that ignores its last parameter, a run under `assertEquivalentArgs` fails, in both Runners. _Validates 1.2, 1.3_
3. **Refusal follows the arity.** For a legacy function with Declared_Arity n from 0 to 4, a Test_Code that calls `assertEquivalent` ends with `TEST_CODE_ERROR` if and only if n is 2 or more, in both Runners. _Validates 2.1, 2.2_
4. **Static_Gate helper rule.** For any parameter count from 0 to 4 and any of the three helper uses (only `assertEquivalent`, only `assertEquivalentArgs`, both), the gate reports `TEST_ASSERT_EQUIVALENT_ARGS` if and only if the count is 2 or more and the use is not "only `assertEquivalentArgs`", and reports `TEST_ASSERT_EQUIVALENT` only when the count is 0 or 1 and `assertEquivalent` is not referenced. _Validates 3.3, 3.4_

## Testing

- Verifier: properties 1 to 3 in `test/multi-argument.test.ts`, plus examples: a non-array `args`, independent copies (a legacy function that mutates its first argument), and the counterexample text.
- Sandbox_Runner: properties 1 to 3 in `test/multi-argument.test.ts` with fewer runs (each case starts a Worker), plus a non-array `args` example.
- Web: property 4 in `static-gate.multi-argument.test.ts`; prompt examples (the JSON line, the instruction lines, the hint); the reincarnate route passes the count to the gate.
- The existing suites must stay green, which covers Requirement 1.5.
