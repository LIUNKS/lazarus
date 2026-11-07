// Verification_Suite: seeded Sample_Corpse data (Requirements 17 to 20).
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { deepEquivalent } from '../harness/deep-equivalent.ts';
import { runPbtTestCode } from '../harness/pbt-runner.ts';
import { transpileToCommonJs, typecheckStrict } from '../harness/typecheck.ts';
import { closePool, dbDescribe, getPool } from './support/db.ts';
import { WORKSPACE_ROOT } from './support/env.ts';
import {
  functionEffects,
  lineHasCurse,
  parseScript,
  topLevelFunction,
  topLevelFunctions,
  walk,
  type AstNode,
  type CurseType,
} from './support/js-analysis.ts';
import { withScratchDatabase } from './support/scratch-db.ts';

interface Row {
  [column: string]: unknown;
}

interface Sample {
  corpse: Row;
  curses: Row[];
  spec: Row;
  reincarnation: Row;
  entry: string;
  inputs: unknown[];
  source: { numRuns: number };
}

const SEED_DIR = join(WORKSPACE_ROOT, 'db', 'seed');
const CURSE_TYPES: CurseType[] = [
  'GLOBAL_POLLUTION',
  'VAR_HOISTING',
  'IMPLICIT_COERCION',
  'CALLBACK_HELL',
  'EVAL_INJECTION',
  'PROTOTYPE_POLLUTION',
];
const BANNED = /100%|mathematical proof|mathematically proven|guaranteed/i;
const ALLOWED_GLOBALS = new Set([
  'Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Error', 'TypeError', 'RangeError', 'Function',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'decodeURIComponent', 'encodeURIComponent', 'undefined', 'NaN', 'Infinity',
]);
const ES5_ADDITIONS = new Set(['forEach', 'map', 'filter', 'reduce', 'reduceRight', 'some', 'every', 'indexOf', 'lastIndexOf', 'keys', 'bind', 'isArray', 'trim', 'JSON', 'create', 'defineProperty', 'getOwnPropertyNames']);

let samples: Sample[] = [];

function ecmaVersionOf(language: string): 3 | 5 {
  return language === 'es3' ? 3 : 5;
}

function sourceInputs(): Map<string, { inputs: unknown[]; numRuns: number }> {
  const map = new Map<string, { inputs: unknown[]; numRuns: number }>();
  for (const folder of readdirSync(SEED_DIR, { withFileTypes: true })) {
    const file = join(SEED_DIR, folder.name, 'sample.json');
    if (!folder.isDirectory() || !existsSync(file)) continue;
    const source = JSON.parse(readFileSync(file, 'utf8')) as { entryFunction: string; inputs: unknown[]; numRuns: number };
    map.set(source.entryFunction, { inputs: source.inputs, numRuns: source.numRuns });
  }
  return map;
}

beforeAll(async () => {
  if (!process.env['TEST_DATABASE_URL']) return;
  const pool = getPool();
  const corpses = (await pool.query('SELECT * FROM public.corpses WHERE is_sample ORDER BY title')).rows as Row[];
  const inputs = sourceInputs();
  for (const corpse of corpses) {
    const id = corpse['id'];
    const curses = (await pool.query('SELECT * FROM public.curses WHERE corpse_id = $1 ORDER BY line_number', [id])).rows as Row[];
    const specs = (await pool.query('SELECT * FROM public.seance_specs WHERE corpse_id = $1', [id])).rows as Row[];
    const reincarnations = (await pool.query('SELECT * FROM public.reincarnations WHERE corpse_id = $1', [id])).rows as Row[];
    const spec = specs[0] as Row;
    const entry = (spec['invariants_json'] as { entry_function: string }).entry_function;
    const source = inputs.get(entry);
    if (!source) throw new Error(`No sample.json found for entry function ${entry}`);
    samples.push({
      corpse,
      curses,
      spec,
      reincarnation: reincarnations[0] as Row,
      entry,
      inputs: source.inputs,
      source: { numRuns: source.numRuns },
    });
  }
});

afterAll(async () => {
  samples = [];
  await closePool();
});

const code = (sample: Sample): string => String(sample.corpse['original_code']);
const language = (sample: Sample): string => String(sample.corpse['source_language']);

function evaluate(sample: Sample): vm.Context {
  const context = vm.createContext({});
  vm.runInContext(code(sample), context, { timeout: 1000 });
  return context;
}

function call(context: vm.Context, entry: string, input: unknown): unknown {
  return vm.runInContext(`${entry}(${JSON.stringify(input)})`, context, { timeout: 1000 });
}

dbDescribe('R17 sample corpse seed data', () => {
  it('R17.1 inserts exactly 3 sample corpses without an owner', () => {
    expect(samples).toHaveLength(3);
    for (const { corpse } of samples) {
      expect(corpse['is_sample']).toBe(true);
      expect(corpse['user_id']).toBeNull();
    }
  });

  it('R17.2 assigns es3, es5-jquery, and legacy-node once each', () => {
    expect(samples.map(language).sort()).toEqual(['es3', 'es5-jquery', 'legacy-node']);
  });

  it('R17.3 sets the status to RESURRECTED', () => {
    for (const { corpse } of samples) expect(corpse['status']).toBe('RESURRECTED');
  });

  it('R17.4 stores the SHA-256 digest of original_code as code_hash', () => {
    for (const sample of samples) {
      const expected = createHash('sha256').update(code(sample), 'utf8').digest('hex');
      expect(sample.corpse['code_hash']).toBe(expected);
      expect(String(sample.corpse['code_hash'])).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('R17.5 gives each corpse a distinct non-blank title of 1 to 200 characters', () => {
    const titles = samples.map((s) => String(s.corpse['title']));
    for (const title of titles) {
      expect(title.length).toBeGreaterThanOrEqual(1);
      expect(title.length).toBeLessThanOrEqual(200);
      expect(title.trim()).not.toBe('');
    }
    expect(new Set(titles).size).toBe(3);
  });

  it('R17.6 parses as a classic script and defines exactly one entry function without module references', () => {
    for (const sample of samples) {
      const program = parseScript(code(sample), ecmaVersionOf(language(sample)));
      expect(topLevelFunctions(program).filter((name) => name === sample.entry)).toHaveLength(1);
      expect(topLevelFunctions(program)).toEqual([sample.entry]);
      const identifiers = new Set<string>();
      walk(program, (node) => {
        if (node.type === 'Identifier') identifiers.add(node['name'] as string);
      });
      for (const forbidden of ['module', 'exports', 'require']) expect(identifiers.has(forbidden), forbidden).toBe(false);
    }
  });

  it('R17.7 the entry function is pure and deterministic', () => {
    for (const sample of samples) {
      const program = parseScript(code(sample), ecmaVersionOf(language(sample)));
      const entry = topLevelFunction(program, sample.entry) as AstNode;
      const { freeReads, freeWrites } = functionEffects(entry);
      for (const name of freeReads) expect(ALLOWED_GLOBALS.has(name), `${sample.entry} reads ${name}`).toBe(true);
      expect([...freeWrites], `${sample.entry} writes globals`).toEqual([]);
      let usesRandom = false;
      walk(entry, (node) => {
        if (node.type === 'MemberExpression' && (node['property'] as AstNode)['name'] === 'random') usesRandom = true;
      });
      expect(usesRandom).toBe(false);

      const context = evaluate(sample);
      for (const input of sample.inputs) {
        expect(deepEquivalent(call(context, sample.entry, input), call(context, sample.entry, input))).toBe(true);
      }
    }
  });

  it('R17.8 runs to completion where $, jQuery, window, document, and global are undefined', () => {
    for (const sample of samples) {
      const context = vm.createContext({});
      for (const name of ['$', 'jQuery', 'window', 'document', 'global']) {
        expect(vm.runInContext(`typeof ${name}`, context)).toBe('undefined');
      }
      expect(() => vm.runInContext(code(sample), context, { timeout: 1000 })).not.toThrow();
    }
  });

  it('R17.9 uses no ES2015 syntax, and no ES5 additions in the es3 sample', () => {
    for (const sample of samples) {
      // The ES3/ES5 grammars reject let, const, arrow functions, template literals, classes, destructuring, spread, and modules.
      const program = parseScript(code(sample), ecmaVersionOf(language(sample)));
      if (language(sample) !== 'es3') continue;
      walk(program, (node) => {
        if (node.type === 'Identifier') expect(ES5_ADDITIONS.has(node['name'] as string), String(node['name'])).toBe(false);
      });
    }
  });

  it('R17.10 returns a defined value within 1000 ms for at least 10 distinct inputs including a boundary input', () => {
    for (const sample of samples) {
      const distinct = new Set(sample.inputs.map((input) => JSON.stringify(input)));
      expect(distinct.size, sample.entry).toBeGreaterThanOrEqual(10);
      expect([...distinct].some((text) => /\[\]|""|\b0\b/.test(text)), `${sample.entry} boundary input`).toBe(true);
      const context = evaluate(sample);
      for (const input of sample.inputs) {
        const started = Date.now();
        expect(call(context, sample.entry, input)).not.toBeUndefined();
        expect(Date.now() - started).toBeLessThan(1000);
      }
    }
  });

  it('R17.11 rolls back every insert of the seed migration when one insert fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lazarus-seed-failure-'));
    try {
      cpSync(join(WORKSPACE_ROOT, 'db', 'migrations', 'V1__create_lazarus_schema.sql'), join(dir, 'V1__create_lazarus_schema.sql'));
      const seed = readFileSync(join(WORKSPACE_ROOT, 'db', 'migrations', 'V2__seed_sample_corpses.sql'), 'utf8');
      writeFileSync(
        join(dir, 'V2__seed_sample_corpses.sql'),
        `${seed}\nINSERT INTO public.curses (corpse_id, curse_type, severity, line_number, description, exorcism_strategy) VALUES (gen_random_uuid(), 'VAR_HOISTING', 'HEX', 1, 'd', 's');\n`,
      );
      await withScratchDatabase(async (db) => {
        const result = db.flyway({ args: [`-locations=filesystem:${dir}`] });
        expect(result.code).not.toBe(0);
        expect(result.output).toContain('V2__seed_sample_corpses.sql');
        const rows = await db.query('SELECT count(*)::int AS n FROM public.corpses');
        expect(rows[0]?.['n']).toBe(0);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('R17.12 the seed migration has no conditional logic that tests for existing rows', () => {
    const seed = readFileSync(join(WORKSPACE_ROOT, 'db', 'migrations', 'V2__seed_sample_corpses.sql'), 'utf8');
    const withoutLiterals = seed.replaceAll(/\$lz\$[\s\S]*?\$lz\$/g, "''").replaceAll(/^--.*$/gm, '');
    expect(withoutLiterals).not.toMatch(/\b(IF|EXISTS|CASE|WHERE|ON\s+CONFLICT|DO)\b/i);
  });
});

dbDescribe('R18 sample curse seed data', () => {
  it('R18.1 inserts between 2 and 10 curses per sample', () => {
    for (const { curses, entry } of samples) {
      expect(curses.length, entry).toBeGreaterThanOrEqual(2);
      expect(curses.length, entry).toBeLessThanOrEqual(10);
    }
  });

  it('R18.2 uses only the defined curse types and severities', () => {
    for (const { curses } of samples) {
      for (const curse of curses) {
        expect(CURSE_TYPES).toContain(curse['curse_type']);
        expect(['HEX', 'BLOOD_CURSE', 'FATAL']).toContain(curse['severity']);
      }
    }
  });

  it('R18.3 keeps every line_number between 1 and the number of lines of the code', () => {
    for (const sample of samples) {
      const lines = code(sample).split('\n').length;
      for (const curse of sample.curses) {
        const line = curse['line_number'] as number;
        expect(Number.isInteger(line)).toBe(true);
        expect(line).toBeGreaterThanOrEqual(1);
        expect(line).toBeLessThanOrEqual(lines);
      }
    }
  });

  it('R18.4 points every curse at a line that contains a construct of its type', () => {
    for (const sample of samples) {
      const program = parseScript(code(sample), ecmaVersionOf(language(sample)));
      for (const curse of sample.curses) {
        const line = curse['line_number'] as number;
        const type = curse['curse_type'] as CurseType;
        expect(lineHasCurse(program, line, type), `${sample.entry} line ${line} (${type})`).toBe(true);
      }
    }
  });

  it('R18.5 includes each of the 6 curse types at least once across the samples', () => {
    const present = new Set(samples.flatMap((s) => s.curses.map((c) => c['curse_type'] as string)));
    for (const type of CURSE_TYPES) expect(present.has(type), type).toBe(true);
  });

  it('R18.6 gives every curse a description and an exorcism strategy of 10 to 500 characters', () => {
    for (const { curses } of samples) {
      for (const curse of curses) {
        for (const column of ['description', 'exorcism_strategy']) {
          const length = String(curse[column]).trim().length;
          expect(length, column).toBeGreaterThanOrEqual(10);
          expect(length, column).toBeLessThanOrEqual(500);
        }
      }
    }
  });
});

dbDescribe('R19 sample Seance spec seed data', () => {
  it('R19.1 inserts exactly one spec per sample', async () => {
    const total = await getPool().query(
      'SELECT count(*)::int AS n FROM public.seance_specs s JOIN public.corpses c ON c.id = s.corpse_id WHERE c.is_sample',
    );
    expect(total.rows[0]?.n).toBe(3);
    for (const { corpse } of samples) {
      const rows = await getPool().query('SELECT id FROM public.seance_specs WHERE corpse_id = $1', [corpse['id']]);
      expect(rows.rows).toHaveLength(1);
    }
  });

  it('R19.2 writes English requirements with 3 to 10 numbered EARS criteria', () => {
    for (const { spec, entry } of samples) {
      const text = String(spec['requirements_md']);
      expect(text.length, entry).toBeGreaterThanOrEqual(200);
      expect(text.length, entry).toBeLessThanOrEqual(5000);
      expect(text, entry).toMatch(/^[\x09\x0a\x0d\x20-\x7e]+$/);
      const criteria = text.split('\n').filter((line) => /^\d+\. /.test(line));
      expect(criteria.length, entry).toBeGreaterThanOrEqual(3);
      expect(criteria.length, entry).toBeLessThanOrEqual(10);
      for (const criterion of criteria) {
        expect(criterion, entry).toMatch(/^\d+\. (THE|WHEN|WHILE|IF|WHERE) /);
        expect(criterion, entry).toContain('SHALL');
      }
    }
  });

  it('R19.3 describes the entry function, its input, and its output in the design', () => {
    for (const { spec, entry } of samples) {
      const design = String(spec['design_md']);
      expect(design.length).toBeGreaterThanOrEqual(100);
      expect(design.length).toBeLessThanOrEqual(3000);
      expect(design).toContain(entry);
      expect(design).toMatch(/Input:/);
      expect(design).toMatch(/Output:/);
    }
  });

  it('R19.4 stores invariants_json with entry_function, input, output, and 3 to 10 invariants', () => {
    for (const { spec } of samples) {
      const json = spec['invariants_json'] as Record<string, unknown>;
      expect(typeof json['entry_function']).toBe('string');
      expect(String(json['entry_function']).length).toBeGreaterThan(0);
      expect(String(json['input']).length).toBeGreaterThan(0);
      expect(String(json['output']).length).toBeGreaterThan(0);
      const invariants = json['invariants'] as unknown[];
      expect(Array.isArray(invariants)).toBe(true);
      expect(invariants.length).toBeGreaterThanOrEqual(3);
      expect(invariants.length).toBeLessThanOrEqual(10);
      for (const item of invariants) {
        expect(typeof item).toBe('string');
        expect((item as string).length).toBeGreaterThanOrEqual(1);
        expect((item as string).length).toBeLessThanOrEqual(300);
      }
    }
  });

  it('R19.5 names the entry function defined in original_code', () => {
    for (const sample of samples) {
      const program = parseScript(code(sample), ecmaVersionOf(language(sample)));
      expect(topLevelFunction(program, sample.entry), sample.entry).toBeDefined();
    }
  });

  it('R19.6 sets approved_at to a timestamp that is not later than the end of the seed migration', async () => {
    // now() is the start time of the migration transaction, so it cannot be later than the moment the migration completed.
    // The corpse rows use the same default, which ties approved_at to that transaction.
    const result = await getPool().query(
      `SELECT s.approved_at, c.created_at, (s.approved_at <= clock_timestamp()) AS not_future
       FROM public.seance_specs s JOIN public.corpses c ON c.id = s.corpse_id AND c.is_sample`,
    );
    expect(result.rows).toHaveLength(3);
    for (const row of result.rows) {
      expect(row.approved_at).not.toBeNull();
      expect(row.not_future).toBe(true);
      expect((row.approved_at as Date).getTime()).toBe((row.created_at as Date).getTime());
    }
  });});

dbDescribe('R20 sample reincarnation seed data', () => {
  function modernExports(sample: Sample): Record<string, unknown> {
    const context = vm.createContext({ exports: {} });
    vm.runInContext(transpileToCommonJs(String(sample.reincarnation['modern_code'])), context, { timeout: 1000 });
    return (context as { exports: Record<string, unknown> }).exports;
  }

  it('R20.1 inserts exactly one reincarnation per sample', async () => {
    for (const { corpse } of samples) {
      const rows = await getPool().query('SELECT id FROM public.reincarnations WHERE corpse_id = $1', [corpse['id']]);
      expect(rows.rows).toHaveLength(1);
    }
  });

  it('R20.2 names TypeScript in a target_stack of 1 to 100 characters', () => {
    for (const { reincarnation } of samples) {
      const stack = String(reincarnation['target_stack']);
      expect(stack.length).toBeGreaterThanOrEqual(1);
      expect(stack.length).toBeLessThanOrEqual(100);
      expect(stack.toLowerCase()).toContain('typescript');
    }
  });

  it('R20.3 compiles modern_code under strict mode and exports the entry function without imports', () => {
    for (const sample of samples) {
      const modern = String(sample.reincarnation['modern_code']);
      expect(typecheckStrict(modern), sample.entry).toEqual([]);
      expect(typeof modernExports(sample)[sample.entry], sample.entry).toBe('function');
      expect(modern).not.toMatch(/^\s*import\s/m);
    }
  });

  it('R20.4 keeps var, any, eval, and reassigned module-level let out of modern_code', () => {
    for (const sample of samples) {
      const file = ts.createSourceFile('modern.ts', String(sample.reincarnation['modern_code']), ts.ScriptTarget.ES2022, true);
      const topLevelLets = new Set<string>();
      for (const statement of file.statements) {
        if (ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Let) !== 0) {
          for (const declaration of statement.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name)) topLevelLets.add(declaration.name.text);
          }
        }
      }
      const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclarationList(node)) {
          expect(node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const), `${sample.entry}: var declaration`).not.toBe(0);
        }
        expect(node.kind, `${sample.entry}: any type`).not.toBe(ts.SyntaxKind.AnyKeyword);
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          expect(node.expression.text, `${sample.entry}: eval`).not.toBe('eval');
        }
        if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
          if (ts.isIdentifier(node.left)) expect(topLevelLets.has(node.left.text), `${sample.entry}: reassigned let`).toBe(false);
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
  });

  it('R20.5 stores a fast-check property test that compares both functions through assertEquivalent', () => {
    for (const { reincarnation, entry } of samples) {
      const test = String(reincarnation['pbt_test_code']);
      expect(test, entry).toMatch(/return\s+fc\.property\(/);
      expect(test, entry).toContain('assertEquivalent(');
      expect(test, entry).not.toMatch(/\b(import|export|require)\b/);
    }
  });

  it('R20.6 stores total_runs from 100 to 1000, equal to the run count used, and hardcodes no run count', () => {
    for (const sample of samples) {
      const runs = sample.reincarnation['total_runs'] as number;
      expect(Number.isInteger(runs)).toBe(true);
      expect(runs).toBeGreaterThanOrEqual(100);
      expect(runs).toBeLessThanOrEqual(1000);
      expect(runs).toBe(sample.source.numRuns);
      expect(String(sample.reincarnation['pbt_test_code'])).not.toMatch(/numRuns\s*[:=]\s*\d+/);
    }
  });

  it('R20.7 records an execution time from 1 to 600000 ms', () => {
    for (const { reincarnation } of samples) {
      const time = reincarnation['execution_time_ms'] as number;
      expect(Number.isInteger(time)).toBe(true);
      expect(time).toBeGreaterThanOrEqual(1);
      expect(time).toBeLessThanOrEqual(600_000);
    }
  });

  it('R20.8 passes the stored property test with the stored run count', async () => {
    for (const sample of samples) {
      const result = await runPbtTestCode({
        legacyCode: code(sample),
        modernCode: String(sample.reincarnation['modern_code']),
        entryFunction: sample.entry,
        testCode: String(sample.reincarnation['pbt_test_code']),
        numRuns: sample.reincarnation['total_runs'] as number,
      });
      expect(result.passed, `${sample.entry}: ${result.message}`).toBe(sample.reincarnation['pbt_passed']);
      expect(result.totalRuns).toBe(sample.reincarnation['total_runs']);
    }
  });

  it('R20.9 never stores a failing reincarnation, and the seed generator aborts on a failing property', () => {
    for (const { reincarnation } of samples) expect(reincarnation['pbt_passed']).not.toBe(false);
    const generator = readFileSync(join(SEED_DIR, 'generate-seed.ts'), 'utf8');
    expect(generator).toContain('if (!run.passed)');
    expect(generator).toContain('throw new Error');
  });

  it('R20.10 keeps the banned phrases out of every seeded text column', async () => {
    const result = await getPool().query(
      `SELECT concat_ws(' ', c.title, c.original_code, x.description, x.exorcism_strategy, s.requirements_md, s.design_md,
                        s.invariants_json::text, r.target_stack, r.modern_code, r.pbt_test_code) AS text
       FROM public.corpses c
       JOIN public.curses x ON x.corpse_id = c.id
       JOIN public.seance_specs s ON s.corpse_id = c.id
       JOIN public.reincarnations r ON r.corpse_id = c.id
       WHERE c.is_sample`,
    );
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) expect(String(row.text)).not.toMatch(BANNED);
  });

  it('R20.11 states any property-test outcome as Empirical_Evidence with the exact run count', () => {
    for (const sample of samples) {
      const runs = sample.reincarnation['total_runs'] as number;
      const texts = [sample.spec['requirements_md'], sample.spec['design_md'], JSON.stringify(sample.spec['invariants_json'])].map(String);
      for (const text of texts) {
        if (!/generated inputs|property[- ]based|verified/i.test(text)) continue;
        expect(text).toMatch(new RegExp(`${runs}|${runs.toLocaleString('en-US')}`));
        expect(text.toLowerCase()).toContain('empirical');
      }
    }
  });

  it('R20.12 sets pbt_passed to true for all 3 reincarnations', () => {
    expect(samples).toHaveLength(3);
    for (const { reincarnation } of samples) expect(reincarnation['pbt_passed']).toBe(true);
  });
});
