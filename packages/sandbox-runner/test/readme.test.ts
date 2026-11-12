import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GATE_CONFIG } from '../src/gate/policy.ts';
import { LIMIT_RANGES } from '../src/options.ts';
import { FORBIDDEN_PHRASES } from './support/samples.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const lower = readme.toLowerCase();

const walk = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

describe('README', () => {
  it('R11.1 has every required section, in order', () => {
    const headings = [...readme.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual([
      'Overview',
      'Usage',
      'Gate and defaults',
      'Limits',
      'Supported and rejected values',
      'Error codes',
      'Threat model',
      'Escape classes the tests do not cover',
      'Verified facts and open items',
    ]);
    const parts = [...readme.matchAll(/^### (.+)$/gm)].map((match) => match[1]);
    for (const part of ['Assets', 'Attacker', 'Layers and what each one addresses', 'What the Sandbox does not protect against', 'Recommended hardening before wider exposure']) {
      expect(parts).toContain(part);
    }
  });

  it('R11.2 states the same-process, node:vm, and Worker facts and the consequence of an escape', () => {
    expect(readme).toContain('same operating-system process as the web server');
    expect(readme).toContain('`node:vm` is not a security mechanism');
    expect(readme).toContain('a Worker thread is not an operating-system sandbox');
    expect(readme).toMatch(/privileges of the server process: its files, its network, and its environment/);
  });

  it('R11.3 lists every item the Sandbox does not protect against', () => {
    for (const item of [
      'Engine and Node.js vulnerabilities',
      'Side channels',
      'Resource exhaustion that outpaces the controls',
      'Forging of the verdict by the author of the code',
      'Denial of service by many requests',
      'Limits of the Node.js permission model',
    ]) {
      expect(readme).toContain(item);
    }
    expect(readme).toContain('no network scope');
    expect(readme).toContain('does not inherit to Worker threads');
    expect(readme).toContain('polled every 100 ms');
  });

  it('R11.4 recommends the hardening steps', () => {
    for (const step of ['separate operating-system process or container', 'no application secrets', 'read-only filesystem', 'no network namespace', 'cgroup limits', 'non-root user', 'microVM', 'external execution service', '`--permission`']) {
      expect(readme).toContain(step);
    }
  });

  it('R11.5 states that user-code execution is off by default and names the field that enables it', () => {
    expect(readme).toContain('User-code execution is off by default');
    expect(readme).toContain('`userExecutionEnabled`');
    expect(DEFAULT_GATE_CONFIG.userExecutionEnabled).toBe(false);
  });

  it('R3.12 states that the concurrency limits apply per process', () => {
    expect(readme).toContain('The concurrency limits are per process');
    expect(readme).toContain('several server instances multiplies the limits');
  });

  it('R5.1 the limits table matches the defaults and ranges in the code', () => {
    for (const [name, range] of Object.entries(LIMIT_RANGES)) {
      expect(readme, name).toContain(`| \`${name}\` | ${range.fallback} | ${range.min} to ${range.max} |`);
    }
  });

  it('R7.10 lists the supported values, the rejected values, and the behavior of cycles and shared references', () => {
    for (const text of ['**Supported:**', '**Rejected in inputs**', '**Cycles and shared references:**', '`cyclic input`', 'Sharing is not preserved', 'back-reference', 'typed arrays', '`WeakMap`']) {
      expect(readme).toContain(text);
    }
  });

  it('R12.7 states which escape classes the tests do not cover', () => {
    const section = readme.slice(readme.indexOf('## Escape classes the tests do not cover'), readme.indexOf('## Verified facts and open items'));
    for (const item of ['engine-level vulnerabilities', 'specific Node.js or V8 patch version', 'native addons', 'side channels', 'rapid external-memory exhaustion', 'operating systems other than the one the tests ran on']) {
      expect(section).toContain(item);
    }
    const corpus = readFileSync(join(root, 'test', 'corpus', 'hostile.ts'), 'utf8');
    for (const item of ['engine-level vulnerabilities', 'native addons', 'side channels', 'rapid external-memory exhaustion', 'one patch version', 'operating systems other than the one the tests ran on']) {
      expect(corpus).toContain(item);
    }
  });

  it('R2.3 the error code table lists every code of a result', () => {
    for (const code of ['LIVE_EXECUTION_DENIED', 'SANDBOX_UNAVAILABLE', 'SANDBOX_TIMEOUT', 'SANDBOX_OUT_OF_MEMORY', 'SANDBOX_FORBIDDEN_CAPABILITY', 'SANDBOX_CRASH', 'OUTPUT_LIMIT_EXCEEDED', 'UNSUPPORTED_VALUE', 'INVALID_OPTIONS', 'LEGACY_LOAD_ERROR', 'ENTRY_FUNCTION_NOT_FOUND', 'MODERN_COMPILE_ERROR', 'MODERN_LOAD_ERROR', 'TEST_CODE_ERROR', 'INTERNAL_ERROR']) {
      expect(readme).toContain(`\`${code}\``);
    }
  });

  it('R11.6 contains no Forbidden_Phrase and no absolute claim about security', () => {
    for (const phrase of FORBIDDEN_PHRASES) expect(lower).not.toContain(phrase);
    // The README describes an isolation layer with limits. These words would claim more than that.
    expect(readme).not.toMatch(/\b(secure|safe|safely|unbreakable|impenetrable|bulletproof|proven|proof|proves)\b/i);
    expect(readme).toContain('empirical evidence');
  });
});

describe('wording of the package', () => {
  it('R6.8 no source file, message, or fixture contains a Forbidden_Phrase or claims the Sandbox is secure', () => {
    // The files that hold the phrases as test data for the redaction are the only exception.
    const exceptions = ['samples.ts', 'adversarial.test.ts', 'property-mode.test.ts', 'readme.test.ts'];
    const files = [...walk(join(root, 'src')), ...walk(join(root, 'test')), ...walk(join(root, 'scripts'))].filter(
      (file) => !exceptions.some((name) => file.endsWith(name)),
    );
    expect(files.length).toBeGreaterThan(30);
    for (const file of files) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      for (const phrase of FORBIDDEN_PHRASES) expect(text, `${file} contains "${phrase}"`).not.toContain(phrase);
      expect(text, file).not.toMatch(/\b(is|are) (secure|safe|proven)\b/);
    }
  });
});
