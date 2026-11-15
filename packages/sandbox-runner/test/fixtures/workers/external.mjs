import { parentPort, workerData } from 'node:worker_threads';
const keep = []; for (let i = 0; i < 48; i++) keep.push(new ArrayBuffer(4 * 1024 * 1024)); setInterval(() => keep.length, 1000);
