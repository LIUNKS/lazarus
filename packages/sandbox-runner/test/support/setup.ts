import { setWorkerDirectoryForTests } from '../../src/host/worker-files.ts';

// Tests import the TypeScript sources, and the Workers run the built files.
setWorkerDirectoryForTests(new URL('../../dist/worker/', import.meta.url));
