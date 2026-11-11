import { parentPort, workerData } from 'node:worker_threads';
parentPort.postMessage('x'.repeat(10000));
