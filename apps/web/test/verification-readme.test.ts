// Checks the `## Verification API` section of apps/web/README.md (08-live-verification-api, Requirements 10 and 12).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { containsForbiddenPhrase } from '../src/lib/pipeline/forbidden';
import { VERIFY_ERROR_CODES, VERIFY_ERROR_TABLE } from '../src/lib/verification/errors';
import { VERIFICATION_LIMITS } from '../src/lib/verification/limits';

const README = readFileSync(path.resolve(import.meta.dirname, '../README.md'), 'utf8').replaceAll('\r\n', '\n');
const START = README.indexOf('\n## Verification API\n');
const NEXT = START === -1 ? -1 : README.indexOf('\n## ', START + 1);
const SECTION = START === -1 ? '' : README.slice(START, NEXT === -1 ? undefined : NEXT + 1);
const TABLE = (SECTION.split('\n### Verification error codes\n')[1] ?? '').split('\n');
// Whitespace is collapsed so a sentence can be found across a line break.
const FLAT = SECTION.replace(/\s+/g, ' ');

describe('README Verification API section', () => {
  it('R12.1 is one section appended after the Pipeline API section, and keeps every pre-existing section (Requirement 12)', () => {
    expect(README.match(/^## Verification API$/gm)).toHaveLength(1);
    expect(README.match(/^## Pipeline API$/gm)).toHaveLength(1);
    expect(START).toBeGreaterThan(README.indexOf('\n## Pipeline API\n'));
    for (const heading of ['# @lazarus/web', '## Commands', '## Environment variables', '## Database', '## GitHub sign-in setup', '## Routes', '## Security notes', '## Tests', '## Known limits']) {
      expect(README.slice(0, START).split('\n'), heading).toContain(heading);
    }
    // The Pipeline API section and its own error table are intact, and come before this section.
    const pipeline = README.slice(README.indexOf('\n## Pipeline API\n'), START);
    expect(pipeline).toContain('\n### Error codes\n');
    expect(pipeline).toContain('| `LLM_TIMEOUT` | 504 |');
    expect(pipeline).toMatch(/On \d{4}-\d{2}-\d{2} a throwaway Client Component/);
  });

  it('R12.1 lists the route, the body, the success shape, the three sources, and the flow order (Requirement 12)', () => {
    expect(SECTION).toContain('`POST /api/verify`');
    expect(SECTION).toContain('{ "corpseId": "<uuid>" }');
    for (const key of ['"ok": true', '"source"', '"reincarnation"', '"targetStack"', '"pbtPassed"', '"totalRuns"', '"executionTimeMs"', '"verification"', '"evidence"', '"corpse"']) {
      expect(SECTION, key).toContain(key);
    }
    for (const source of ['precomputed', 'stored', 'executed']) expect(SECTION).toContain(`| \`${source}\` |`);
    const order = ['verified member', 'belongs to the caller', '`reincarnations` row', 'already has a verdict', 'Verification is enabled', 'entry function can be read', 'quota is reserved', 'grants a Lease', '`record_verification`'];
    const flow = SECTION.slice(SECTION.indexOf('\n### Flow\n'));
    const positions = order.map((text) => flow.indexOf(text));
    for (const [index, position] of positions.entries()) expect(position, order[index]).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('R12.1 states the quota values and the file that holds them (Requirement 12)', () => {
    expect(VERIFICATION_LIMITS.userQuota).toEqual({ limit: 10, windowSeconds: 3_600 });
    expect(VERIFICATION_LIMITS.globalQuota).toEqual({ limit: 100, windowSeconds: 86_400 });
    expect(SECTION).toContain('`apps/web/src/lib/verification/limits.ts`');
    expect(FLAT).toContain('10 verification runs per user in a rolling 60 minutes');
    expect(FLAT).toContain('100 verification runs in total in a rolling 24 hours');
    expect(FLAT).toContain('per server process, not across instances');
  });

  it('R4.7 states the flag statement and the kill switch values, including the fail-closed rule (Requirement 4)', () => {
    expect(FLAT).toContain('`USER_EXECUTION_ENABLED`');
    expect(FLAT).toContain('is shipped as `false`');
    expect(FLAT).toContain('deliberate, reviewed code change');
    expect(FLAT).toContain('Threat_Model of `07-sandboxed-execution`');
    expect(FLAT).toContain('`LAZARUS_SANDBOX_KILL_SWITCH`');
    expect(FLAT).toMatch(/`1` or `true`.*engages it/);
    expect(FLAT).toMatch(/unset, empty, `0`, or `false` leaves it off/);
    expect(FLAT).toContain('treated as engaged (fail closed)');
  });

  it('R10.3 R10.5 states the empirical nature, the run count, and the limitations (a) to (g) (Requirement 10)', () => {
    expect(FLAT).toContain('empirical evidence from randomly generated inputs');
    expect(FLAT).toContain('1,000');
    expect(FLAT).toContain('not an exhaustive check');
    const limitations: Array<[string, string]> = [
      ['(a)', 'visible only to the owner of the corpse under RLS, and it is not an attestation'],
      ['(b)', 'owner UPDATE policy of the Foundation allows it'],
      ['(c)', 'Code under test can influence the verdict of its own run'],
      ['(d)', 'result is final'],
      ['(e)', 'stores nothing and still uses one unit of quota'],
      ['(f)', 'concurrency limits apply per server process'],
      ['(g)', 'Neither the seed nor the counterexample is stored or returned'],
    ];
    for (const [label, text] of limitations) {
      expect(FLAT, label).toContain(`- ${label} `);
      expect(FLAT, label).toContain(text);
    }
  });

  it('R10.4 describes the future hardening as optional and says why it is not in this spec (Requirement 10)', () => {
    expect(SECTION).toContain('\n### Future hardening\n');
    expect(FLAT).toContain('optional future change, not part of this spec');
    expect(FLAT).toContain('column-level privileges');
    expect(FLAT).toContain('service role key');
    expect(FLAT).toContain('signing secret');
  });

  it('R12.3 explains how to reproduce a run (Requirement 12)', () => {
    for (const text of ['`original_code`', '`modern_code`', '`pbt_test_code`', '`entry_function`', '`invariants_json`', '`seed`', '`verification_run`', '`runSandboxedVerification`', '`numRuns` 1,000', 'trusted environment']) {
      expect(FLAT, text).toContain(text);
    }
  });

  it('R12.2 lists exactly the error codes of the source, each once, with its status and one sentence (Requirement 12)', () => {
    const rows = TABLE.filter((line) => /^\| `[A-Z_]+` \|/.test(line)).map((line) => line.split('|').map((cell) => cell.trim()));
    const codes = rows.map((cells) => cells[1]!.replaceAll('`', ''));
    expect(codes.length).toBe(new Set(codes).size);
    expect([...codes].sort()).toEqual([...VERIFY_ERROR_CODES].sort());
    for (const cells of rows) {
      const code = cells[1]!.replaceAll('`', '') as (typeof VERIFY_ERROR_CODES)[number];
      expect(Number(cells[2]), code).toBe(VERIFY_ERROR_TABLE[code].status);
      expect(cells[3]!.length, code).toBeGreaterThan(20);
      expect(cells[3]!.endsWith('.') || cells[3]!.endsWith(')'), code).toBe(true);
    }
  });

  it('R10.1 contains no Forbidden_Phrase (Requirement 10)', () => {
    expect(SECTION.length).toBeGreaterThan(2_000);
    expect(containsForbiddenPhrase(SECTION)).toBe(false);
  });
});
