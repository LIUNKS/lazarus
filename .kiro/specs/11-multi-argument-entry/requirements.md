# Requirements Document

## Introduction

The Test_Code_Contract calls each Entry_Function with one argument: `assertEquivalent(input)` runs `legacyFn(input)` and `modernFn(input)`. Many legacy functions take several positional parameters, for example `calculateShipping(weightKg, zone, isExpress)`. For such a function the generated test passes the whole input as the first parameter and `undefined` for the others. Both versions then usually agree on a meaningless result (for example `NaN`), and a run can report equivalence without having compared the real behavior.

This spec adds a second comparison helper, `assertEquivalentArgs(args)`, that spreads an array of generated values into the positional parameters. It makes both runners refuse the old one-argument call for a function that declares two or more parameters, and it makes `POST /api/reincarnate` generate tests that use the right helper.

**Prerequisites.** Specs `03-pbt-verifier`, `05-llm-pipeline-api`, `07-sandboxed-execution`, and `08-live-verification-api` are implemented.

**Changes to files of other specs.** Listed in `design.md`. Every change is additive: a Test_Code that uses only the five existing parameters for a function with zero or one parameter gets the same result as before.

**Out of scope:** `legacyFn` and `modernFn` for direct calls stay one-argument; the cases mode of `packages/sandbox-runner`; the Foundation harness in `db/harness/` (the three Sample_Corpses take one parameter each); functions that read `arguments` without declaring parameters; regenerating a stored reincarnation (Requirement 2 makes an old one-argument test of a multi-parameter function end with `TEST_CODE_ERROR` instead of a verdict); any UI change, route, migration, or dependency.

## Glossary

- **Verifier**, **Test_Code**, **Entry_Function**, **Legacy_Fn**, **Modern_Fn**, **Equivalent_Outcomes**: As defined in `03-pbt-verifier`.
- **Sandbox_Runner**, **Driver_Context**, **Side_Adapter**: As defined in `07-sandboxed-execution`.
- **Runner**: The Verifier (Test_Code mode) or the property mode of the Sandbox_Runner.
- **Declared_Arity**: The value of the own data property `length` of Legacy_Fn as the Runner loaded it. A missing, accessor, or non-integer `length` counts as 0.
- **Entry_Params**: The parameter names that `extractFunctionSignatures` of `@lazarus/mcp-curse-scanner` reports for the top-level declaration of the Entry_Function in the legacy code.
- **Multi_Parameter**: Two or more parameters.
- **Static_Gate**: `runStaticGate` in `apps/web/src/lib/pipeline/static-gate.ts`.

## Requirements

### Requirement 1: The `assertEquivalentArgs` helper

**User Story:** As a member, I want a function with several parameters to be compared on generated values for every parameter, so that a reported equivalence reflects its real behavior.

#### Acceptance Criteria

1. THE Runner SHALL call the Test_Code body with six parameters in this order: `fc`, `legacyFn`, `modernFn`, `assertEquivalent`, `numRuns`, `assertEquivalentArgs`.
2. WHEN Test_Code calls `assertEquivalentArgs(args)` with an array, THE Runner SHALL call Legacy_Fn and Modern_Fn each with the elements of its own independent deep copy of `args` as positional arguments, with `this` undefined, and SHALL compare the two outcomes with the rules of Equivalent_Outcomes.
3. WHEN the outcomes of a call of `assertEquivalentArgs` are not equivalent, THE Runner SHALL treat the call exactly as a non-equivalent call of `assertEquivalent`, and the reported counterexample SHALL show the `args` array.
4. IF `args` is not an array, THEN THE Runner SHALL end the run with `TEST_CODE_ERROR` and a message that says that `assertEquivalentArgs` expects an array of arguments.
5. WHEN a Test_Code uses only the first five parameters and Declared_Arity is 0 or 1, THE Runner SHALL produce the same result as before this spec.

### Requirement 2: Refusing the one-argument call for a Multi_Parameter function

**User Story:** As a member, I want a test that passes one argument to a function with several parameters to be refused, so that it can never report equivalence.

#### Acceptance Criteria

1. WHEN Declared_Arity is 2 or more AND Test_Code calls `assertEquivalent`, THE Runner SHALL end the run with `TEST_CODE_ERROR`, SHALL NOT report `PASSED` or `FAILED`, and its message SHALL state the Declared_Arity and name `assertEquivalentArgs`.
2. WHILE Declared_Arity is 0 or 1, THE Runner SHALL accept both `assertEquivalent` and `assertEquivalentArgs`.

### Requirement 3: Generation of the test by `POST /api/reincarnate`

**User Story:** As a member, I want the generated test to call my function the way it is declared, so that a live verification of it can reach a verdict.

#### Acceptance Criteria

1. THE reincarnate prompt SHALL contain the Entry_Params of the Entry_Function as JSON, outside the delimited blocks and introduced as derived from the untrusted code.
2. THE reincarnate instructions SHALL state that the Test_Code may use the sixth parameter `assertEquivalentArgs`; that for an Entry_Function with no parameter or one parameter the property calls `assertEquivalent(input)`; that for a Multi_Parameter Entry_Function the property calls `assertEquivalentArgs(args)` with an array that holds one generated value per parameter in order; and that the modern function keeps the parameters of the legacy function in the same order.
3. WHEN the Entry_Params hold two or more names, THE Static_Gate SHALL reject a `pbtTestCode` that does not reference `assertEquivalentArgs`, or that references `assertEquivalent`, with the new rule `TEST_ASSERT_EQUIVALENT_ARGS`, and SHALL NOT apply the rule `TEST_ASSERT_EQUIVALENT`.
4. WHEN the Entry_Params hold zero or one name, or the Entry_Function is not among the Entry_Candidates, THE Static_Gate SHALL apply its rules as before this spec.
5. THE retry prompt SHALL explain the rule `TEST_ASSERT_EQUIVALENT_ARGS` with a fixed sentence, like every other rule.

### Requirement 4: Documentation

**User Story:** As a maintainer, I want the contract written where the agent and readers look, so that later work keeps it.

#### Acceptance Criteria

1. THE Test_Code_Contract in `.kiro/steering/database-and-exorcism.md` SHALL describe the sixth parameter and the rule of Requirement 2.
2. THE READMEs of `packages/pbt-verifier` and `packages/sandbox-runner` SHALL describe `assertEquivalentArgs` and the refusal of Requirement 2.
3. THE repository README SHALL state that Multi_Parameter entry functions are compared through `assertEquivalentArgs`, and that a function that reads `arguments` without declaring parameters is compared as a one-parameter function.
