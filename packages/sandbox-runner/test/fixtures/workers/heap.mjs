import { parentPort, workerData } from 'node:worker_threads';
const keep = []; for (;;) keep.push(new Array(100000).fill(keep.length));
