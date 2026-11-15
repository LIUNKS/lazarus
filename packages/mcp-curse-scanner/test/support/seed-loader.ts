import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURSE_TYPE_ORDER, SOURCE_LANGUAGES } from '../../src/scanner/constants.ts';
import type { CurseType, Severity, SourceLanguage } from '../../src/lib.ts';

export interface SeededCurse {
  type: CurseType;
  severity: Severity;
  match: string;
  seededLine: number;
}

export interface LoadedSample {
  folder: string;
  sourceLanguage: SourceLanguage;
  entryFunction: string;
  legacy: string;
  curses: SeededCurse[];
}

export interface SeedLoad {
  samples: LoadedSample[];
  problems: string[];
}

/** From test/support/, four levels up is the Workspace_Root. */
export const defaultSeedDir = fileURLToPath(new URL('../../../../db/seed/', import.meta.url));

const SEVERITIES: readonly Severity[] = ['HEX', 'BLOOD_CURSE', 'FATAL'];
const PREFIX = 'Foundation_Spec prerequisite not met:';

/**
 * The rule of db/seed/generate-seed.ts: the 1-based number of the first line that contains the marker,
 * or null when the marker does not occur. Expects text whose CR LF were already replaced by LF.
 */
export function seededLineOf(legacy: string, match: string): number | null {
  const index = legacy.split('\n').findIndex((line) => line.includes(match));
  return index === -1 ? null : index + 1;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function invalidField(folder: string, field: string, expected: string): string {
  return `${PREFIX} Sample_Source "${folder}": sample.json field "${field}" is missing or invalid (expected ${expected}).`;
}

function loadSample(seedDir: string, folder: string, problems: string[]): LoadedSample | null {
  const legacyPath = join(seedDir, folder, 'legacy.js');
  const samplePath = join(seedDir, folder, 'sample.json');
  let missing = false;
  for (const [path, name] of [[legacyPath, 'legacy.js'], [samplePath, 'sample.json']] as const) {
    if (!existsSync(path)) {
      problems.push(`${PREFIX} Sample_Source "${folder}": db/seed/${folder}/${name} is missing.`);
      missing = true;
    }
  }
  if (missing) return null;

  const legacy = readFileSync(legacyPath, 'utf8').replace(/\r\n/g, '\n');
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(samplePath, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown parser error';
    problems.push(`${PREFIX} Sample_Source "${folder}": db/seed/${folder}/sample.json is not valid JSON (${reason}).`);
    return null;
  }
  if (!isRecord(json)) {
    problems.push(invalidField(folder, 'sample.json', 'a JSON object'));
    return null;
  }

  const before = problems.length;
  const sourceLanguage = SOURCE_LANGUAGES.find((language) => language === json.sourceLanguage);
  if (sourceLanguage === undefined) {
    problems.push(invalidField(folder, 'sourceLanguage', 'one of es3, es5-jquery, legacy-node'));
  }
  const entryFunction = json.entryFunction;
  if (typeof entryFunction !== 'string' || entryFunction === '') {
    problems.push(invalidField(folder, 'entryFunction', 'a non-empty string'));
  }

  const curses: SeededCurse[] = [];
  const rawCurses = json.curses;
  if (!Array.isArray(rawCurses) || rawCurses.length === 0) {
    problems.push(invalidField(folder, 'curses', 'an array with at least one entry'));
  } else {
    rawCurses.forEach((entry: unknown, index) => {
      const item = isRecord(entry) ? entry : {};
      const type = CURSE_TYPE_ORDER.find((candidate) => candidate === item.type);
      const severity = SEVERITIES.find((candidate) => candidate === item.severity);
      const match = item.match;
      let valid = true;
      if (type === undefined) {
        problems.push(invalidField(folder, `curses[${index}].type`, 'one of the six Curse_Types'));
        valid = false;
      }
      if (severity === undefined) {
        problems.push(invalidField(folder, `curses[${index}].severity`, 'one of HEX, BLOOD_CURSE, FATAL'));
        valid = false;
      }
      if (typeof match !== 'string' || match === '') {
        problems.push(invalidField(folder, `curses[${index}].match`, 'a non-empty string'));
        return;
      }
      const seededLine = seededLineOf(legacy, match);
      if (seededLine === null) {
        problems.push(
          `${PREFIX} Sample_Source "${folder}": curses[${index}].match "${match}" does not occur in db/seed/${folder}/legacy.js.`,
        );
        return;
      }
      if (valid && type !== undefined && severity !== undefined) curses.push({ type, severity, match, seededLine });
    });
  }

  if (problems.length > before || sourceLanguage === undefined || typeof entryFunction !== 'string') return null;
  return { folder, sourceLanguage, entryFunction, legacy, curses };
}

/** Never throws: every defect is collected as a problem message. */
export function loadSeedSamples(seedDir: string = defaultSeedDir): SeedLoad {
  const problems: string[] = [];
  const samples: LoadedSample[] = [];

  if (!existsSync(seedDir)) {
    problems.push(
      `${PREFIX} the directory db/seed/ does not exist. Implement spec 01-lazarus-foundation (Sample_Sources under db/seed/) before running the agreement tests.`,
    );
    return { samples, problems };
  }

  let folders: string[];
  try {
    folders = readdirSync(seedDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    problems.push(`${PREFIX} the directory db/seed/ cannot be read.`);
    return { samples, problems };
  }

  if (folders.length === 0) {
    problems.push(
      `${PREFIX} the directory db/seed/ contains no Sample_Source subdirectory (expected folders such as invoice-totals, each with legacy.js and sample.json).`,
    );
    return { samples, problems };
  }

  for (const folder of folders) {
    const sample = loadSample(seedDir, folder, problems);
    if (sample !== null) samples.push(sample);
  }
  return { samples, problems };
}
