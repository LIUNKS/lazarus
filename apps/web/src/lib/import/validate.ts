import { SOURCE_LANGUAGES, type SourceLanguage } from '@/lib/data/types';
import { normalizeNewlines } from './hash';
import { IMPORT_LIMITS } from './limits';

/** What the Server Action learned about the uploaded file before validation. */
export type ImportFile =
  | { kind: 'none' }
  | { kind: 'text'; text: string }
  | { kind: 'too-large' }
  | { kind: 'invalid-utf8' };

export interface ImportInput {
  title: string;
  language: string;
  pastedCode: string;
  repoUrl: string;
  file: ImportFile;
}

export interface ImportValue {
  title: string;
  language: SourceLanguage;
  /** Source code with every CR LF replaced by LF. */
  code: string;
  repoUrl: string | null;
}

export type ImportField = 'title' | 'language' | 'code' | 'repoUrl';
export type ImportErrors = Partial<Record<ImportField, string>>;
export type ImportValidation = { ok: true; value: ImportValue } | { ok: false; errors: ImportErrors };

const ENCODER = new TextEncoder();

function isSourceLanguage(value: string): value is SourceLanguage {
  return (SOURCE_LANGUAGES as readonly string[]).includes(value);
}

function validateRepoUrl(raw: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const value = raw.trim();
  if (value === '') return { ok: true, value: null };
  if (value.length > IMPORT_LIMITS.maxRepoUrl) return { ok: false, error: 'Use a repository URL of at most 2,048 characters.' };
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
      return { ok: false, error: 'Enter an https:// URL without credentials.' };
    }
  } catch {
    return { ok: false, error: 'Enter a valid https:// URL.' };
  }
  return { ok: true, value };
}

function validateCode(input: ImportInput): { ok: true; code: string } | { ok: false; error: string } {
  const hasPasted = input.pastedCode.trim() !== '';
  const hasFile = input.file.kind !== 'none';

  if (hasFile && hasPasted) return { ok: false, error: 'Provide either a file or pasted code, not both.' };
  if (input.file.kind === 'too-large') return { ok: false, error: 'The file is larger than 100 KB.' };
  if (input.file.kind === 'invalid-utf8') return { ok: false, error: 'The file is not valid UTF-8 text.' };

  const raw = input.file.kind === 'text' ? input.file.text : input.pastedCode;
  if (raw.trim() === '') return { ok: false, error: 'Provide the source code, as a file or as pasted text.' };
  if (!raw.isWellFormed()) return { ok: false, error: 'The code is not valid UTF-8 text.' };
  if (raw.includes('\u0000')) return { ok: false, error: 'The code contains a NUL character.' };
  if (ENCODER.encode(raw).length > IMPORT_LIMITS.maxBytes) return { ok: false, error: 'The code is larger than 100 KB.' };
  return { ok: true, code: normalizeNewlines(raw) };
}

/** Pure validation of an import. The Server Action calls it; nothing here trusts the client. */
export function validateImport(input: ImportInput): ImportValidation {
  const errors: ImportErrors = {};

  const title = input.title.trim();
  if (title === '') errors.title = 'Enter a title.';
  else if ([...title].length > IMPORT_LIMITS.maxTitle) errors.title = 'Use a title of at most 200 characters.';

  if (!isSourceLanguage(input.language)) errors.language = 'Choose the language of the code.';

  const code = validateCode(input);
  if (!code.ok) errors.code = code.error;

  const repo = validateRepoUrl(input.repoUrl);
  if (!repo.ok) errors.repoUrl = repo.error;

  if (Object.keys(errors).length > 0 || !code.ok || !repo.ok || !isSourceLanguage(input.language)) {
    return { ok: false, errors };
  }
  return { ok: true, value: { title, language: input.language, code: code.code, repoUrl: repo.value } };
}