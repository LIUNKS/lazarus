// Run by apps/web/test/build-output.test.ts in a child process. Loads the Sandbox_Runner from apps/web the way
// POST /api/verify does, runs one seeded sample corpse live, and records every module file Node.js loads and every file
// read. It prints one JSON line: the run status and the files and pnpm links that the trace of the route does not list.
// The deployed function holds only the traced files, so a file missing here is a file missing in production.
//
// Usage: node verify-trace-check.mjs <path to route.js.nft.json>
import fs, { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = path.resolve(APP, '../..');
const SAMPLE_ID = '5a3f0c1e-0001-4000-8000-000000000001';
/** The links Node.js walks to resolve each package that a sample run loads. */
const LINKS = [
  'apps/web/node_modules/@lazarus/sandbox-runner',
  'packages/sandbox-runner/node_modules/@lazarus/pbt-verifier',
  'packages/sandbox-runner/node_modules/fast-check',
  'packages/pbt-verifier/node_modules/fast-check',
  'packages/pbt-verifier/node_modules/typescript',
];

const used = new Set();
const remember = (file) => {
  try {
    used.add(realpathSync(file));
  } catch {
    // Not a file on disk.
  }
};
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:')) remember(fileURLToPath(url));
    return nextLoad(url, context);
  },
});
const originalRead = fs.readFileSync;
fs.readFileSync = function recordingRead(file, ...rest) {
  if (typeof file === 'string') remember(file);
  else if (file instanceof URL && file.protocol === 'file:') remember(fileURLToPath(file));
  return originalRead.call(this, file, ...rest);
};

/** The three values of the sample that the route reads from the database, taken from the seed migration. */
function seededSample() {
  const sql = readFileSync(path.join(REPO, 'db/migrations/V2__seed_sample_corpses.sql'), 'utf8');
  const sample = {};
  // A statement ends at a semicolon before the next statement or a comment. The sample code itself has semicolons at
  // line ends, so a plain split on ";\n" would cut it.
  for (const statement of sql.split(/;\s*\n(?=INSERT INTO|--|\s*$)/)) {
    const values = [...statement.matchAll(/\$lz\$([\s\S]*?)\$lz\$/g)].map((match) => match[1]);
    if (values[0] !== SAMPLE_ID) continue;
    if (statement.includes('INSERT INTO public.corpses')) sample.legacyCode = values[3];
    if (statement.includes('INSERT INTO public.seance_specs')) sample.entryFunction = JSON.parse(values[3]).entry_function;
    if (statement.includes('INSERT INTO public.reincarnations')) [sample.modernCode, sample.testCode] = [values[2], values[3]];
  }
  return sample;
}

const traceFile = path.resolve(process.argv[2]);
const traceDir = path.dirname(traceFile);
const traced = new Set();
const tracedLinks = new Set();
for (const entry of JSON.parse(readFileSync(traceFile, 'utf8')).files.map((file) => path.resolve(traceDir, file))) {
  try {
    if (lstatSync(entry).isSymbolicLink()) tracedLinks.add(entry.toLowerCase());
    traced.add(realpathSync(entry).toLowerCase());
  } catch {
    // An entry that is not on disk cannot hide a missing file.
  }
}

const runnerPath = createRequire(path.join(APP, 'package.json')).resolve('@lazarus/sandbox-runner');
const { createLiveExecutionGate, verifyLive } = await import(pathToFileURL(runnerPath).href);
// The Gate as the route creates it: user execution off, anonymous sample runs off.
const gate = createLiveExecutionGate({ userExecutionEnabled: false, allowAnonymousSampleRuns: false });
const result = await verifyLive(
  { origin: 'sample', caller: { kind: 'member', userId: 'trace-check' }, corpusOwnerId: null, numRuns: 100, seed: 42, ...seededSample() },
  gate,
);

const repo = realpathSync(REPO).toLowerCase();
const inRepo = [...used].filter((file) => file.toLowerCase().startsWith(repo) && file !== fileURLToPath(import.meta.url));
const missingFiles = inRepo.filter((file) => !traced.has(file.toLowerCase())).map((file) => path.relative(REPO, file).replaceAll('\\', '/'));
const missingLinks = LINKS.filter((link) => !tracedLinks.has(path.join(REPO, link).toLowerCase()));
if (![...tracedLinks].some((link) => link.includes('pure-rand'))) missingLinks.push('fast-check -> pure-rand');

process.stdout.write(
  `${JSON.stringify({ status: result.status, code: result.code ?? null, executor: result.executor, totalRuns: result.totalRuns ?? null, usedFiles: inRepo.length, missingFiles, missingLinks })}\n`,
);
