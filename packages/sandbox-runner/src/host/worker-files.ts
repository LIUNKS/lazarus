export type WorkerEntry = 'exec' | 'compile';

// After the build this module is dist/host/worker-files.js and the bundled entries are in dist/worker/.
let directory = new URL('../worker/', import.meta.url);

export function workerEntryUrl(entry: WorkerEntry): URL {
  return new URL(`${entry}-entry.js`, directory);
}

/**
 * Internal, for tests only (not exported from the package): tests import the TypeScript sources, so
 * they point this module at the built `dist/worker/` directory, or at a directory without worker
 * files to exercise the unavailable path.
 */
export function setWorkerDirectoryForTests(url: URL): void {
  directory = url;
}
