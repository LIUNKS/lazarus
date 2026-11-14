// Vitest setup file: makes a test fail, with an error that names the access, when it
//  - calls `fetch`,
//  - opens a socket through `node:net` or `node:tls`, or
//  - reads an LLM_Config variable that the test did not set itself (Requirement 20 criteria 1 and 13).
// A guard error is thrown synchronously at the call site, so it fails only the test that triggered it.
import net from 'node:net';
import tls from 'node:tls';
import { vi } from 'vitest';

const GUARDED_ENV_NAMES: ReadonlySet<string> = new Set([
  'GROQ_API_KEY',
  'LLM_MODEL',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'LLM_FALLBACK_MODEL',
]);

function blocked(access: string): never {
  throw new Error(`Test guard: blocked access to ${access}. Pipeline tests need no network, database, or LLM variable.`);
}

globalThis.fetch = (() => blocked('the network through fetch')) as typeof fetch;

// `node:net` and `node:tls` are CommonJS modules, so the default export object is the live module object.
net.connect = (() => blocked('the network through net.connect')) as typeof net.connect;
net.createConnection = (() => blocked('the network through net.createConnection')) as typeof net.createConnection;
tls.connect = (() => blocked('the network through tls.connect')) as typeof tls.connect;

// `vi.stubEnv` reads the original value of the variable before it assigns the stub, and that read is not
// a read by the code under test. The wrapper below lets this one internal read through.
let insideStubEnv = false;
const originalStubEnv = vi.stubEnv.bind(vi);
vi.stubEnv = ((name: string, value: string | undefined) => {
  insideStubEnv = true;
  try {
    return originalStubEnv(name, value);
  } finally {
    insideStubEnv = false;
  }
}) as typeof vi.stubEnv;

const realEnv = process.env;
process.env = new Proxy(realEnv, {
  get(target, property) {
    if (typeof property === 'string' && GUARDED_ENV_NAMES.has(property) && !insideStubEnv && !Object.hasOwn(target, property)) {
      blocked(`the environment variable ${property} (the test did not set it)`);
    }
    return Reflect.get(target, property);
  },
});
