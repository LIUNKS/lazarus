// Checks the `## Pipeline API` section of apps/web/README.md (Requirement 21).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ERROR_TABLE } from '../src/lib/pipeline/errors';
import { containsForbiddenPhrase } from '../src/lib/pipeline/forbidden';
import { LIMITS } from '../src/lib/pipeline/limits';

const README = readFileSync(path.resolve(import.meta.dirname, '../README.md'), 'utf8').replaceAll('\r\n', '\n');
const START = README.indexOf('\n## Pipeline API\n');
const SECTION = START === -1 ? '' : README.slice(START);
const TABLE = (SECTION.split('\n### Error codes\n')[1] ?? '').split('\n');

describe('R21 README Pipeline API section (Requirement 21)', () => {
  it('R21.1 has one Pipeline API section and keeps every pre-existing section, with a content marker for each (Requirement 21)', () => {
    expect(README.match(/^## Pipeline API$/gm)).toHaveLength(1);
    const markers: Array<[string, string]> = [
      ['# @lazarus/web', 'The Lazarus web application: Next.js 16 (App Router)'],
      ['## Commands', 'pnpm --filter @lazarus/web dev'],
      ['## Environment variables', '`NEXT_PUBLIC_SUPABASE_ANON_KEY`'],
      ['## Database', 'Judge mode needs the sample corpses'],
      ['## GitHub sign-in setup', 'Create a **GitHub OAuth application**'],
      ['## Routes', '`/crypt`, `/import`'],
      ['## Security notes', 'getSession()` is never used for authorization'],
      ['## Tests', 'GitHub sign-in against a real Supabase project'],
      ['## Known limits', 'No Content-Security-Policy is set yet'],
    ];
    for (const [heading, marker] of markers) {
      const at = README.indexOf(heading.startsWith('# @') ? heading : `\n${heading}\n`);
      expect(at, heading).toBeGreaterThanOrEqual(0);
      expect(README.includes(marker), `${heading}: ${marker}`).toBe(true);
      // Every old section comes before the new one, so the new section only adds to the end.
      expect(at, heading).toBeLessThan(START === -1 ? Number.MAX_SAFE_INTEGER : START + 1);
    }
  });

  it('R21.1 documents each route with its name, request body, success shape, and the four result sources (Requirement 21)', () => {
    for (const heading of ['### `POST /api/scan`', '### `POST /api/seance`', '### `POST /api/reincarnate`']) expect(SECTION.includes(`\n${heading}\n`), heading).toBe(true);
    expect(SECTION).toContain('{ "corpseId": "<uuid>" }');
    for (const source of ['precomputed', 'stored', 'cache', 'generated']) expect(SECTION, source).toMatch(new RegExp(`\\| \`${source}\` \\|`));
    for (const field of ['"lineCount"', '"curses"', '"seance"', '"invariants"', '"reincarnation"', '"verification"', '"evidence"', '"corpse"']) expect(SECTION, field).toContain(field);
  });

  it('R21.4 lists exactly the error codes of the source, each once, with a status and one sentence (Requirement 21)', () => {
    const rows = TABLE.filter((line) => /^\| `[A-Z_]+` \|/.test(line)).map((line) => line.split('|').map((cell) => cell.trim()));
    const codes = rows.map((cells) => cells[1]!.replaceAll('`', ''));
    expect(codes.length).toBe(new Set(codes).size);
    expect([...codes].sort()).toEqual([...ERROR_CODES].sort());
    for (const cells of rows) {
      const code = cells[1]!.replaceAll('`', '') as (typeof ERROR_CODES)[number];
      expect(Number(cells[2]), code).toBe(ERROR_TABLE[code].status);
      expect(cells[3]!.length, code).toBeGreaterThan(20);
      expect(cells[3]!.endsWith('.') || cells[3]!.endsWith(')'), code).toBe(true);
    }
  });

  it('R21.5 states the quota values, the file that holds them, the cache rule, and the unexecuted-corpse statement (Requirement 21)', () => {
    expect(LIMITS.userQuota).toEqual({ limit: 20, windowSeconds: 3_600 });
    expect(LIMITS.globalQuota).toEqual({ limit: 500, windowSeconds: 86_400 });
    expect(SECTION).toMatch(/User_Quota \| 20 reservations per user per rolling 60 minutes/);
    expect(SECTION).toMatch(/Global_Quota \| 500 reservations in total per rolling 24 hours/);
    expect(SECTION).toContain('`apps/web/src/lib/pipeline/limits.ts`');
    expect(SECTION).toContain('a stored row of another visible corpse with the same `code_hash` is reused and no LLM call is made');
    expect(SECTION).toContain('User corpses are generated but not executed until `08-live-verification-api` enables live verification (which builds on `07-sandboxed-execution`)');
  });

  it('R21.2 states that a Visitor never triggers an LLM call and that the service role key is never used (Requirement 21)', () => {
    expect(SECTION).toContain('A Visitor never triggers an LLM call.');
    expect(SECTION).toContain('The service role key is never used by the Pipeline API.');
  });

  it('R19.6 R21 describes results as empirical evidence and holds no Forbidden_Phrase (Requirement 19 and 21)', () => {
    expect(SECTION).toContain('empirical evidence');
    expect(containsForbiddenPhrase(SECTION)).toBe(false);
  });

  it('R1.10 records the result of the server-only build probe after the main section content (Requirement 1)', () => {
    const probe = SECTION.indexOf('\n### Server-only check\n');
    expect(probe).toBeGreaterThan(SECTION.indexOf('\n### Error codes\n'));
    expect(SECTION.slice(probe)).toMatch(/On \d{4}-\d{2}-\d{2} a throwaway Client Component .* made `pnpm --filter @lazarus\/web build` fail .*names that import/s);
  });

  it('R21.1 the existing README ends before the new section with its original last line intact (Requirement 21)', () => {
    expect(START).toBeGreaterThan(0);
    expect(README.slice(0, START)).toMatch(/- No Content-Security-Policy is set yet; it will be designed together with the final pages\.\n$/);
  });
});
