import { parentPort, workerData } from 'node:worker_threads';
for (let i = 0; i < 2000; i++) { process.stdout.write('o'.repeat(1000)); process.stderr.write('e'.repeat(1000)); } parentPort.postMessage('done');
