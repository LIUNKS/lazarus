// Generates db/migrations/V2__seed_sample_corpses.sql from the authored sample sources in db/seed/<sample>/.
//
// For every sample the generator:
//   - computes the SHA-256 code_hash of original_code,
//   - resolves each curse line number from a text marker,
//   - runs pbt_test_code through the db/harness runner and records pbt_passed, total_runs, and execution_time_ms,
//   - refuses to emit anything when a property test fails.
//
// The generated file is committed and must not be edited by hand: Flyway validates its checksum.
// Usage: node db/seed/generate-seed.ts [--force]
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { runPbtTestCode } from '../harness/pbt-runner.ts';

interface CurseSource {
  type: string;
  severity: string;
  match: string;
  description: string;
  strategy: string;
}

interface SampleSource {
  title: string;
  sourceLanguage: string;
  entryFunction: string;
  targetStack: string;
  numRuns: number;
  seed: number;
  requirementsTitle: string;
  criteria: string[];
  design: string;
  invariants: { input: string; output: string; list: string[] };
  curses: CurseSource[];
}

// Order matters: it fixes the order of the INSERT statements.
const SAMPLES = [
  { folder: 'invoice-totals', corpseId: '5a3f0c1e-0001-4000-8000-000000000001' },
  { folder: 'query-string-parser', corpseId: '5a3f0c1e-0002-4000-8000-000000000002' },
  { folder: 'batch-calculator', corpseId: '5a3f0c1e-0003-4000-8000-000000000003' },
] as const;

const OUTPUT_PATH = new URL('../migrations/V2__seed_sample_corpses.sql', import.meta.url);
const DOLLAR_TAG = '$lz$';
const BANNED_PHRASES = /100%|mathematical proof|mathematically proven|guaranteed/i;

function quote(text: string): string {
  if (text.includes(DOLLAR_TAG)) throw new Error(`Text contains the reserved quoting tag ${DOLLAR_TAG}.`);
  if (BANNED_PHRASES.test(text)) throw new Error(`Text contains a banned phrase: ${text.slice(0, 80)}`);
  return `${DOLLAR_TAG}${text}${DOLLAR_TAG}`;
}

function lineOf(code: string, marker: string): number {
  const index = code.split('\n').findIndex((line) => line.includes(marker));
  if (index === -1) throw new Error(`Curse marker not found in original code: ${marker}`);
  return index + 1;
}

function requirementsMarkdown(source: SampleSource): string {
  const numbered = source.criteria.map((criterion, index) => `${index + 1}. ${criterion}`).join('\n');
  return `# Requirements: ${source.requirementsTitle}\n\n## Acceptance Criteria\n\n${numbered}\n`;
}

async function renderSample(folder: string, corpseId: string): Promise<string> {
  const base = new URL(`./${folder}/`, import.meta.url);
  const read = (name: string): string => readFileSync(new URL(name, base), 'utf8').replace(/\r\n/g, '\n');
  const source = JSON.parse(read('sample.json')) as SampleSource;
  const originalCode = read('legacy.js');
  const modernCode = read('modern.ts');
  const testCode = read('test-code.js');

  const run = await runPbtTestCode({
    legacyCode: originalCode,
    modernCode,
    entryFunction: source.entryFunction,
    testCode,
    numRuns: source.numRuns,
    seed: source.seed,
  });
  if (!run.passed) {
    throw new Error(`Property test failed for sample "${source.title}" (${folder}):\n${run.message}`);
  }
  console.log(`${folder}: passed ${run.totalRuns} runs in ${run.executionTimeMs} ms (seed ${source.seed}).`);

  const codeHash = createHash('sha256').update(originalCode, 'utf8').digest('hex');
  const invariants = JSON.stringify({
    entry_function: source.entryFunction,
    input: source.invariants.input,
    output: source.invariants.output,
    invariants: source.invariants.list,
  });

  const curseRows = source.curses
    .map(
      (curse) =>
        `  (${quote(corpseId)}::uuid, ${quote(curse.type)}, ${quote(curse.severity)}, ${lineOf(originalCode, curse.match)}, ${quote(curse.description)}, ${quote(curse.strategy)})`,
    )
    .join(',\n');

  return `-- Sample: ${source.title}
INSERT INTO public.corpses (id, user_id, is_sample, title, source_language, original_code, code_hash, status)
VALUES (
  ${quote(corpseId)}::uuid,
  NULL,
  true,
  ${quote(source.title)},
  ${quote(source.sourceLanguage)},
  ${quote(originalCode)},
  ${quote(codeHash)},
  'RESURRECTED'
);

INSERT INTO public.curses (corpse_id, curse_type, severity, line_number, description, exorcism_strategy)
VALUES
${curseRows};

INSERT INTO public.seance_specs (corpse_id, requirements_md, design_md, invariants_json, approved_at)
VALUES (
  ${quote(corpseId)}::uuid,
  ${quote(requirementsMarkdown(source))},
  ${quote(source.design)},
  ${quote(invariants)}::jsonb,
  now()
);

INSERT INTO public.reincarnations (corpse_id, target_stack, modern_code, pbt_test_code, pbt_passed, total_runs, execution_time_ms)
VALUES (
  ${quote(corpseId)}::uuid,
  ${quote(source.targetStack)},
  ${quote(modernCode)},
  ${quote(testCode)},
  true,
  ${run.totalRuns},
  ${run.executionTimeMs}
);
`;
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  if (existsSync(OUTPUT_PATH) && !force) {
    console.error(
      'V2__seed_sample_corpses.sql already exists. Regenerating changes its checksum, and every database that applied it ' +
        'would fail Flyway validation. Pass --force only before the migration is applied anywhere.',
    );
    process.exit(1);
  }

  const parts: string[] = [
    '-- V2: three executable sample corpses (Sample_Corpse rows) with curses, Seance specs, and reincarnations.',
    '-- GENERATED by db/seed/generate-seed.ts. Do not edit by hand: Flyway validates the checksum of this file.',
    '-- pbt_passed, total_runs, and execution_time_ms come from one real execution of each pbt_test_code.',
    '',
  ];
  for (const sample of SAMPLES) {
    parts.push(await renderSample(sample.folder, sample.corpseId));
  }
  writeFileSync(OUTPUT_PATH, parts.join('\n'), 'utf8');
  console.log(`Wrote ${OUTPUT_PATH.pathname}`);
}

await main();
