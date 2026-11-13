import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { workerEntryUrl, type WorkerEntry } from './worker-files.js';

/** How one Worker ended. Exactly one of these is reported per Worker; the first one wins. */
export type WorkerEnd =
  | { kind: 'message'; payload: string }
  | { kind: 'timeout' }
  | { kind: 'oom' }
  | { kind: 'crash' }
  | { kind: 'output-limit' }
  | { kind: 'unavailable' };

/** Only strings, numbers, and booleans go to a Worker (Requirement 4, criterion 3). */
export type WorkerData = Record<string, string | number | boolean>;

export interface SpawnLimits {
  /** The host calls `terminate()` when this time has passed. */
  killAfterMs: number;
  maxOldGenerationSizeMb: number;
  maxYoungGenerationSizeMb: number;
  maxExternalMemoryMb: number;
  maxResultBytes: number;
}

const WATCHDOG_INTERVAL_MS = 100;
const TERMINATE_WAIT_MS = 1_000;
const BYTES_PER_MB = 1_048_576;

let liveWorkers = 0;
let createdWorkers = 0;

/** Internal counters, for tests only (not exported from the package). */
export function liveWorkerCount(): number {
  return liveWorkers;
}
export function createdWorkerCount(): number {
  return createdWorkers;
}

/**
 * Runs one Worker from `entryUrl` and resolves when it has ended and has been terminated. It never
 * rejects, and it waits only on Worker events and timers, so the host event loop stays free.
 */
export function spawnWorker(entryUrl: URL, data: WorkerData, limits: SpawnLimits): Promise<WorkerEnd> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      if (!existsSync(fileURLToPath(entryUrl))) return resolve({ kind: 'unavailable' });
      worker = new Worker(entryUrl, {
        workerData: data,
        env: {}, // the default would copy the environment of the host
        argv: [],
        execArgv: [], // do not inherit the CLI options of the parent
        stdout: true, // captured, then drained and discarded below
        stderr: true,
        resourceLimits: {
          maxOldGenerationSizeMb: limits.maxOldGenerationSizeMb,
          maxYoungGenerationSizeMb: limits.maxYoungGenerationSizeMb,
        },
        name: 'lazarus-sandbox',
      });
      createdWorkers += 1;
      liveWorkers += 1;

      let settled = false;
      const settle = (end: WorkerEnd): void => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        clearInterval(watchdog);
        // Terminate on every path, and wait for it for a bounded time.
        const waitLimit = new Promise<void>((done) => setTimeout(done, TERMINATE_WAIT_MS).unref());
        void Promise.race([worker.terminate().catch(() => undefined), waitLimit]).then(() => resolve(end));
      };

      const killTimer = setTimeout(() => settle({ kind: 'timeout' }), limits.killAfterMs);
      // External memory (ArrayBuffer contents) is outside `resourceLimits`. The host value
      // `process.memoryUsage().arrayBuffers` covers only the host thread (measured: it stays flat while
      // a Worker holds 192 MB), so the watchdog asks the Worker's own isolate. This is best effort: a
      // fast allocation burst can pass the limit between two polls.
      let polling = false;
      const watchdog = setInterval(() => {
        if (polling || settled || typeof worker.getHeapStatistics !== 'function') return;
        polling = true;
        worker.getHeapStatistics().then(
          (statistics) => {
            polling = false;
            if (statistics.external_memory > limits.maxExternalMemoryMb * BYTES_PER_MB) settle({ kind: 'oom' });
          },
          () => {
            polling = false;
          },
        );
      }, WATCHDOG_INTERVAL_MS);

      // The host never reads what a Worker prints. It only keeps the streams from filling up.
      worker.stdout.resume();
      worker.stderr.resume();

      worker.once('exit', () => {
        liveWorkers -= 1;
        settle({ kind: 'crash' });
      });
      worker.on('error', (error: unknown) => {
        const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
        settle({ kind: code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'oom' : 'crash' });
      });
      worker.on('messageerror', () => settle({ kind: 'crash' }));
      worker.on('message', (message: unknown) => {
        if (typeof message !== 'string') return settle({ kind: 'crash' });
        if (Buffer.byteLength(message, 'utf8') > limits.maxResultBytes) return settle({ kind: 'output-limit' });
        settle({ kind: 'message', payload: message });
      });
    } catch {
      resolve({ kind: 'unavailable' });
    }
  });
}

/** Runs the bundled Exec_Worker or Compile_Worker entry. */
export function spawnRun(entry: WorkerEntry, data: WorkerData, limits: SpawnLimits): Promise<WorkerEnd> {
  return spawnWorker(workerEntryUrl(entry), data, limits);
}
