// The five validation rules for a Seance_Output (Requirement 10). Pure module: the verdict depends on the
// arguments only (no time, randomness, database, or network). All five rules are evaluated every time,
// so the list of failed rules is complete. Values are never modified. Trimming applies only inside the checks.
import { containsForbiddenPhrase } from './forbidden';
import type { EntryCandidate } from './types';

export type SeanceRule =
  | 'REQUIREMENTS_FORMAT'
  | 'DESIGN_FORMAT'
  | 'INVARIANTS_SHAPE'
  | 'ENTRY_FUNCTION_MATCH'
  | 'FORBIDDEN_PHRASE';

export type SeanceVerdict = { ok: true } | { ok: false; failedRules: SeanceRule[] };

// An EARS_Criterion: a numbered line that starts with one of the EARS keywords and contains the word SHALL.
const EARS_LINE = /^\s{0,3}\d{1,3}[.)]\s+(?:THE|WHEN|WHILE|IF|WHERE)\b.*\bSHALL\b/;
const LINE_BREAK = /\r\n|\r|\n/;

export function countEarsCriteria(requirementsMd: string): number {
  return requirementsMd.split(LINE_BREAK).filter((line) => EARS_LINE.test(line)).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimmedLengthWithin(value: unknown, min: number, max: number): value is string {
  if (typeof value !== 'string') return false;
  const length = value.trim().length;
  return length >= min && length <= max;
}

/** At least 95% of the alphabetic characters are Basic Latin letters. Text without letters fails. */
function mostlyBasicLatin(text: string): boolean {
  let letters = 0;
  let basicLatin = 0;
  for (const char of text) {
    if (!/\p{L}/u.test(char)) continue;
    letters++;
    if (/[A-Za-z]/.test(char)) basicLatin++;
  }
  return letters > 0 && basicLatin / letters >= 0.95;
}

function entryFunctionOf(invariants: unknown): string | null {
  return isRecord(invariants) && typeof invariants['entry_function'] === 'string' ? invariants['entry_function'] : null;
}

function requirementsFormatOk(requirementsMd: unknown): boolean {
  if (typeof requirementsMd !== 'string') return false;
  if (requirementsMd.length < 200 || requirementsMd.length > 5_000) return false;
  if (!mostlyBasicLatin(requirementsMd)) return false;
  const criteria = countEarsCriteria(requirementsMd);
  return criteria >= 3 && criteria <= 10;
}

function designFormatOk(designMd: unknown, entryFunction: string | null): boolean {
  if (typeof designMd !== 'string') return false;
  if (designMd.length < 100 || designMd.length > 3_000) return false;
  return entryFunction !== null && entryFunction.length > 0 && designMd.includes(entryFunction);
}

function invariantsShapeOk(invariants: unknown): boolean {
  if (!isRecord(invariants)) return false;
  const keys = Object.keys(invariants).sort();
  if (keys.join(',') !== 'entry_function,input,invariants,output') return false;
  if (!trimmedLengthWithin(invariants['entry_function'], 1, 300)) return false;
  if (!trimmedLengthWithin(invariants['input'], 1, 300)) return false;
  if (!trimmedLengthWithin(invariants['output'], 1, 300)) return false;
  const list = invariants['invariants'];
  if (!Array.isArray(list) || list.length < 3 || list.length > 10) return false;
  return list.every((item) => trimmedLengthWithin(item, 1, 300));
}

function entryFunctionMatches(entryFunction: string | null, candidates: readonly EntryCandidate[]): boolean {
  return entryFunction !== null && candidates.some((candidate) => candidate.name === entryFunction);
}

/** `output` is typed `unknown` because model output is data: any wrong type counts as a failure of the rule it affects. */
export function validateSeanceOutput(output: unknown, candidates: readonly EntryCandidate[]): SeanceVerdict {
  const record = isRecord(output) ? output : {};
  const entryFunction = entryFunctionOf(record['invariants']);

  const failedRules: SeanceRule[] = [];
  if (!requirementsFormatOk(record['requirementsMd'])) failedRules.push('REQUIREMENTS_FORMAT');
  if (!designFormatOk(record['designMd'], entryFunction)) failedRules.push('DESIGN_FORMAT');
  if (!invariantsShapeOk(record['invariants'])) failedRules.push('INVARIANTS_SHAPE');
  if (!entryFunctionMatches(entryFunction, candidates)) failedRules.push('ENTRY_FUNCTION_MATCH');
  if (containsForbiddenPhrase(output)) failedRules.push('FORBIDDEN_PHRASE');
  return failedRules.length === 0 ? { ok: true } : { ok: false, failedRules };
}
