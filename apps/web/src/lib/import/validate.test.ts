import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { IMPORT_LIMITS } from './limits';
import { validateImport, type ImportInput } from './validate';

const VALID: ImportInput = {
  title: 'Old module',
  language: 'es5-jquery',
  pastedCode: 'function f() { return 1; }\r\n',
  repoUrl: '',
  file: { kind: 'none' },
};

const failing = (override: Partial<ImportInput>) => validateImport({ ...VALID, ...override });

describe('R11 import validation: examples', () => {
  it('accepts a valid import and normalizes CR LF', () => {
    const result = validateImport(VALID);
    expect(result).toEqual({
      ok: true,
      value: { title: 'Old module', language: 'es5-jquery', code: 'function f() { return 1; }\n', repoUrl: null },
    });
  });

  it('accepts code from a file and a repository URL', () => {
    const result = validateImport({
      ...VALID,
      pastedCode: '',
      file: { kind: 'text', text: 'var a = 1;' },
      repoUrl: ' https://github.com/acme/legacy ',
    });
    expect(result.ok && result.value.repoUrl).toBe('https://github.com/acme/legacy');
  });

  it.each([
    ['blank title', { title: '   ' }, 'title'],
    ['long title', { title: 'x'.repeat(201) }, 'title'],
    ['unknown language', { language: 'python2' }, 'language'],
    ['empty language', { language: '' }, 'language'],
    ['empty code', { pastedCode: '' }, 'code'],
    ['whitespace-only code', { pastedCode: ' \n\t ' }, 'code'],
    ['NUL character', { pastedCode: 'a\u0000b' }, 'code'],
    ['lone surrogate', { pastedCode: 'a\ud800b' }, 'code'],
    ['oversize pasted code', { pastedCode: 'a'.repeat(IMPORT_LIMITS.maxBytes + 1) }, 'code'],
    ['oversize multibyte code', { pastedCode: '\u00e9'.repeat(IMPORT_LIMITS.maxBytes / 2 + 1) }, 'code'],
    ['oversize file', { pastedCode: '', file: { kind: 'too-large' } }, 'code'],
    ['invalid UTF-8 file', { pastedCode: '', file: { kind: 'invalid-utf8' } }, 'code'],
    ['file and pasted text', { file: { kind: 'text', text: 'var a;' } }, 'code'],
    ['http repository URL', { repoUrl: 'http://example.test/repo' }, 'repoUrl'],
    ['javascript repository URL', { repoUrl: 'javascript:alert(1)' }, 'repoUrl'],
    ['credentials in URL', { repoUrl: 'https://user:pass@example.test/r' }, 'repoUrl'],
    ['malformed URL', { repoUrl: 'not a url' }, 'repoUrl'],
    ['very long URL', { repoUrl: `https://example.test/${'a'.repeat(2048)}` }, 'repoUrl'],
  ] as const)('rejects %s', (_label, override, field) => {
    const result = failing(override as Partial<ImportInput>);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toContain(field);
  });

  it('accepts code of exactly the size limit and a title of exactly 200 characters', () => {
    expect(failing({ pastedCode: 'a'.repeat(IMPORT_LIMITS.maxBytes), title: 'x'.repeat(200) }).ok).toBe(true);
  });

  it('counts the title in characters, not UTF-16 units', () => {
    expect(failing({ title: '😀'.repeat(200) }).ok).toBe(true);
    expect(failing({ title: '😀'.repeat(201) }).ok).toBe(false);
  });

  it('reports one message per invalid field', () => {
    const result = validateImport({ ...VALID, title: '', language: 'x', pastedCode: '', repoUrl: 'ftp://x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['code', 'language', 'repoUrl', 'title']);
  });
});

// An independent oracle for the rules of Requirement 11 criterion 3.
function oracleAccepts(input: ImportInput): boolean {
  const titleOk = input.title.trim().length > 0 && Array.from(input.title.trim()).length <= 200;
  const languageOk = ['es3', 'es5-jquery', 'legacy-node'].includes(input.language);
  const hasFile = input.file.kind !== 'none';
  const pastedBlank = input.pastedCode.trim() === '';
  let codeOk: boolean;
  if (hasFile && !pastedBlank) codeOk = false;
  else if (input.file.kind === 'too-large' || input.file.kind === 'invalid-utf8') codeOk = false;
  else {
    const raw = input.file.kind === 'text' ? input.file.text : input.pastedCode;
    codeOk =
      raw.trim() !== '' &&
      raw.isWellFormed() &&
      !raw.includes(String.fromCharCode(0)) &&
      Buffer.byteLength(raw, 'utf8') <= 102_400;
  }
  let repoOk = true;
  const repo = input.repoUrl.trim();
  if (repo !== '') {
    repoOk = repo.length <= 2048 && /^https:\/\/[^\s/@:]+(:\d+)?([/?#]\S*)?$/i.test(repo);
  }
  return titleOk && languageOk && codeOk && repoOk;
}

describe('R11 import validation: oracle property', () => {
  const fileArbitrary = fc.oneof(
    fc.constant({ kind: 'none' as const }),
    fc.string({ maxLength: 40 }).map((text) => ({ kind: 'text' as const, text })),
    fc.constant({ kind: 'too-large' as const }),
    fc.constant({ kind: 'invalid-utf8' as const }),
  );

  it('never throws and accepts exactly what the oracle accepts', () => {
    fc.assert(
      fc.property(
        fc.record({
          title: fc.oneof(fc.string({ maxLength: 20 }), fc.constantFrom('', '  ', 'Valid title')),
          language: fc.oneof(fc.constantFrom('es3', 'es5-jquery', 'legacy-node'), fc.string({ maxLength: 8 })),
          pastedCode: fc.oneof(fc.string({ maxLength: 40 }), fc.constantFrom('', '   ', 'var a = 1;', 'a\u0000b')),
          repoUrl: fc.oneof(fc.constantFrom('', 'https://github.com/a/b', 'http://a.test', 'https://u:p@a.test', 'zzz'), fc.string({ maxLength: 20 })),
          file: fileArbitrary,
        }),
        (input) => {
          const result = validateImport(input as ImportInput);
          expect(result.ok).toBe(oracleAccepts(input as ImportInput));
        },
      ),
      { numRuns: 2000 },
    );
  });
});