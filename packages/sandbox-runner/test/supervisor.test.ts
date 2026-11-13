import { describe, expect, it } from 'vitest';
import { parseCasesResult, parseCompileResult, parsePropertyResult } from '../src/host/result-parser.ts';
import { createdWorkerCount, liveWorkerCount, spawnWorker, type SpawnLimits, type WorkerEnd } from '../src/host/supervisor.ts';

const fixture = (name: string): URL => new URL(`./fixtures/workers/${name}.mjs`, import.meta.url);

const limits: SpawnLimits = {
  killAfterMs: 5_000,
  maxOldGenerationSizeMb: 32,
  maxYoungGenerationSizeMb: 8,
  maxExternalMemoryMb: 256,
  maxResultBytes: 4_096,
};

/** Runs a fixture and checks the cleanup that must hold on every path. */
async function run(name: string, overrides: Partial<SpawnLimits> = {}, data = {}): Promise<WorkerEnd> {
  const liveBefore = liveWorkerCount();
  const createdBefore = createdWorkerCount();
  const end = await spawnWorker(fixture(name), data, { ...limits, ...overrides });
  expect(createdWorkerCount()).toBe(createdBefore + 1);
  // The Worker is terminated; give its exit event a moment if termination hit the wait limit.
  for (let i = 0; i < 50 && liveWorkerCount() !== liveBefore; i++) await new Promise((r) => setTimeout(r, 20));
  expect(liveWorkerCount()).toBe(liveBefore);
  return end;
}

describe('supervisor', () => {
  it('R4.3 creates the Worker with an empty env, no inherited execArgv, and primitive workerData', async () => {
    const end = await run('echo', {}, { text: 'a', count: 2, flag: true });
    expect(end.kind).toBe('message');
    if (end.kind !== 'message') return;
    expect(JSON.parse(end.payload)).toEqual({ envKeys: 0, execArgv: [], argvLength: 2, data: { text: 'a', count: 2, flag: true } });
  });

  it('R5.4 terminates a Worker that never answers and reports a timeout', async () => {
    const started = Date.now();
    expect(await run('hang', { killAfterMs: 300 })).toEqual({ kind: 'timeout' });
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('R5.5 reports out of memory when the Worker reaches its heap limit', async () => {
    expect(await run('heap')).toEqual({ kind: 'oom' });
  });

  it('R5.6 the watchdog reports out of memory when external memory grows past the limit', async () => {
    expect(await run('external', { maxExternalMemoryMb: 16 })).toEqual({ kind: 'oom' });
  });

  it('R5.7 reports a crash for an uncaught error and for a non-zero exit', async () => {
    expect(await run('throw')).toEqual({ kind: 'crash' });
    expect(await run('exit')).toEqual({ kind: 'crash' });
  });

  it('R5.8 discards a result longer than maxResultBytes', async () => {
    expect(await run('big')).toEqual({ kind: 'output-limit' });
  });

  it('R5.8 reports a crash for a result that is not a string', async () => {
    expect(await run('object')).toEqual({ kind: 'crash' });
  });

  it('R4.3 drains a Worker that floods stdout and stderr, and writes nothing to the host streams', async () => {
    const writes: unknown[] = [];
    const original = [process.stdout.write, process.stderr.write] as const;
    process.stdout.write = ((chunk: unknown) => (writes.push(chunk), true)) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown) => (writes.push(chunk), true)) as typeof process.stderr.write;
    let end: WorkerEnd;
    try {
      end = await run('flood');
    } finally {
      [process.stdout.write, process.stderr.write] = original;
    }
    expect(end).toEqual({ kind: 'message', payload: 'done' });
    expect(writes).toEqual([]);
  });

  it('R5.8 the first message wins and a second message is ignored', async () => {
    expect(await run('twice')).toEqual({ kind: 'message', payload: 'first' });
  });

  it('R3.14 a missing worker file is reported as unavailable and creates no Worker', async () => {
    const before = createdWorkerCount();
    expect(await spawnWorker(fixture('does-not-exist'), {}, limits)).toEqual({ kind: 'unavailable' });
    expect(createdWorkerCount()).toBe(before);
  });

  it('R5.11 the host event loop stays responsive while a Worker hangs', async () => {
    const due = Date.now() + 100;
    let firedAt = 0;
    setTimeout(() => (firedAt = Date.now()), 100);
    await run('hang', { killAfterMs: 400 });
    expect(firedAt).toBeGreaterThan(0);
    expect(firedAt - due).toBeLessThan(250);
  });
});

describe('result parser', () => {
  const max = 4_096;

  it('R6.7 accepts a passed result only with the requested run count', () => {
    expect(parsePropertyResult('{"t":"passed","runs":100}', max, 100)).toEqual({ ok: true, value: { kind: 'passed', totalRuns: 100 } });
    expect(parsePropertyResult('{"t":"passed","runs":99}', max, 100)).toEqual({ ok: false, code: 'SANDBOX_CRASH' });
  });

  it('R6.7 rebuilds a failed result from validated fields and drops unknown fields', () => {
    const payload = JSON.stringify({ t: 'failed', runs: 7, input: '[1]', legacy: 'returned 1', modern: 'returned 2', shrunk: true, stack: 'at /host/x.js', extra: { a: 1 } });
    expect(parsePropertyResult(payload, max, 100)).toEqual({
      ok: true,
      value: { kind: 'failed', totalRuns: 7, input: '[1]', legacyOutcome: 'returned 1', modernOutcome: 'returned 2', shrunk: true },
    });
  });

  it('R6.7 rejects wrong types, out-of-range values, and oversized strings as a crash', () => {
    const bad = [
      'not json', '[]', '5', 'null', '{}', '{"t":"other"}',
      '{"t":"failed","runs":0,"input":"","legacy":"","modern":"","shrunk":true}',
      '{"t":"failed","runs":101,"input":"","legacy":"","modern":"","shrunk":true}',
      '{"t":"failed","runs":1.5,"input":"","legacy":"","modern":"","shrunk":true}',
      '{"t":"failed","runs":1,"input":5,"legacy":"","modern":"","shrunk":true}',
      '{"t":"failed","runs":1,"input":"","legacy":"","modern":"","shrunk":"yes"}',
      JSON.stringify({ t: 'failed', runs: 1, input: 'x'.repeat(2001), legacy: '', modern: '', shrunk: false }),
      JSON.stringify({ t: 'failed', runs: 1, input: '', legacy: 'x'.repeat(501), modern: '', shrunk: false }),
      '{"t":"error","code":"LIVE_EXECUTION_DENIED","message":"x"}',
      '{"t":"error","code":"INVALID_OPTIONS","message":"x"}',
      '{"t":"error","code":"TEST_CODE_ERROR","message":""}',
      JSON.stringify({ t: 'error', code: 'TEST_CODE_ERROR', message: 'x'.repeat(501) }),
    ];
    for (const payload of bad) expect(parsePropertyResult(payload, max, 100), payload).toEqual({ ok: false, code: 'SANDBOX_CRASH' });
  });

  it('R6.7 accepts an error result with a code a Worker may report', () => {
    expect(parsePropertyResult('{"t":"error","code":"SANDBOX_TIMEOUT","message":"The legacy side timed out.","more":1}', max, 100)).toEqual({
      ok: true,
      value: { kind: 'error', code: 'SANDBOX_TIMEOUT', message: 'The legacy side timed out.' },
    });
  });

  it('R5.8 rejects a payload over maxResultBytes, counted in UTF-8 bytes', () => {
    // 1,400 three-byte characters are 4,200 bytes but only 1,400 UTF-16 units.
    const payload = JSON.stringify({ t: 'error', code: 'TEST_CODE_ERROR', message: '€'.repeat(1_400) });
    expect(parsePropertyResult(payload, max, 100)).toEqual({ ok: false, code: 'OUTPUT_LIMIT_EXCEEDED' });
  });

  it('R10.3 validates every case of a cases result and the number of cases', () => {
    const one = { e: true, l: { k: 'r', r: '1' }, m: { k: 't', n: 'TypeError' } };
    expect(parseCasesResult(JSON.stringify({ t: 'cases', cases: [one] }), max, 1)).toEqual({
      ok: true,
      value: { kind: 'cases', cases: [{ equivalent: true, legacy: { kind: 'returned', rendered: '1' }, modern: { kind: 'threw', name: 'TypeError' } }] },
    });
    const bad = [
      { t: 'cases', cases: [one, one] },
      { t: 'cases', cases: [{ ...one, e: 'yes' }] },
      { t: 'cases', cases: [{ ...one, l: { k: 'r', r: 'x'.repeat(201) } }] },
      { t: 'cases', cases: [{ ...one, m: { k: 'x' } }] },
      { t: 'cases', cases: 'none' },
    ];
    for (const payload of bad) expect(parseCasesResult(JSON.stringify(payload), max, 1)).toEqual({ ok: false, code: 'SANDBOX_CRASH' });
  });

  it('R5.12 validates the result of the compile stage', () => {
    expect(parseCompileResult('{"ok":true,"js":"exports.f = 1;"}', max)).toEqual({ ok: true, value: { kind: 'compiled', js: 'exports.f = 1;' } });
    expect(parseCompileResult('{"ok":false,"code":"MODERN_COMPILE_ERROR","message":"1:1 TS1 x"}', max)).toEqual({
      ok: true,
      value: { kind: 'error', code: 'MODERN_COMPILE_ERROR', message: '1:1 TS1 x' },
    });
    for (const payload of ['{"ok":true}', '{"ok":false,"code":"OTHER","message":"x"}', '{"ok":"yes","js":""}']) {
      expect(parseCompileResult(payload, max)).toEqual({ ok: false, code: 'SANDBOX_CRASH' });
    }
  });
});
