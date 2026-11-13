import { parentPort, workerData } from 'node:worker_threads';
parentPort.postMessage(JSON.stringify({ envKeys: Object.keys(process.env).length, execArgv: process.execArgv, argvLength: process.argv.length, data: workerData }));
