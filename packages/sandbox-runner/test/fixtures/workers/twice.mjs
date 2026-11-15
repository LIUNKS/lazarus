import { parentPort, workerData } from 'node:worker_threads';
parentPort.postMessage('first'); parentPort.postMessage('second'); setInterval(() => {}, 1000);
