import { describe, expect, it } from 'vitest';
import {
  FAILURE_PRESENTATIONS,
  PIPELINE_ERROR_CODES,
  ROUTE_FAILURE_OVERRIDES,
  presentFailure,
  presentSuccess,
  type FailureKind,
} from './errors';
import { RESULT_SOURCES, type PipelineOutcome, type PipelineRoute } from './pipeline-client';
import { containsForbiddenTerm } from './wording';

const ROUTES = Object.keys(RESULT_SOURCES) as PipelineRoute[];
const CLIENT_KINDS = ['NETWORK', 'CLIENT_TIMEOUT', 'UNKNOWN'] as const;
const failure = (kind: FailureKind, retryAfterSeconds: number | null = null): Extract<PipelineOutcome, { kind: 'failure' }> => ({
  kind: 'failure',
  failure: kind,
  status: 500,
  retryAfterSeconds,
});

describe('R11.1 the closed list of Error_Codes', () => {
  it('holds the 26 codes: 21 of the Pipeline_API and 5 of the verification route', () => {
    expect(PIPELINE_ERROR_CODES).toHaveLength(26);
    expect(new Set(PIPELINE_ERROR_CODES).size).toBe(26);
    expect(PIPELINE_ERROR_CODES.slice(21)).toEqual([
      'REINCARNATION_REQUIRED',
      'VERIFICATION_DISABLED',
      'VERIFICATION_BUSY',
      'VERIFICATION_INCONCLUSIVE',
      'SANDBOX_UNAVAILABLE',
    ]);
  });

  it('has exactly one presentation for each of the 26 codes and the 3 client outcomes', () => {
    expect(Object.keys(FAILURE_PRESENTATIONS).sort()).toEqual([...PIPELINE_ERROR_CODES, ...CLIENT_KINDS].sort());
  });

  it.each([...PIPELINE_ERROR_CODES, ...CLIENT_KINDS])('R11.1 %s has a non-empty fixed title and message', (kind) => {
    const entry = FAILURE_PRESENTATIONS[kind];
    expect(entry.title.trim()).not.toBe('');
    expect(entry.message.trim()).not.toBe('');
    expect(entry.message.endsWith('.')).toBe(true);
  });

  it('R11.9 no title or message contains a Forbidden_Term, a stack trace, SQL, or a provider name', () => {
    const texts = [
      ...Object.values(FAILURE_PRESENTATIONS).flatMap((entry) => [entry.title, entry.message]),
      ...Object.values(ROUTE_FAILURE_OVERRIDES).flatMap((byKind) => Object.values(byKind).flatMap((entry) => [entry.title, entry.message])),
    ];
    for (const text of texts) {
      expect(containsForbiddenTerm(text)).toBe(false);
      expect(text).not.toMatch(/\bat \w+\.(ts|js)|SELECT |INSERT |SQLSTATE|groq|openai|google|supabase|stack trace/i);
    }
  });

  it('R11.10 gives each of the five verification codes its own title and message', () => {
    const codes = ['REINCARNATION_REQUIRED', 'VERIFICATION_DISABLED', 'VERIFICATION_BUSY', 'VERIFICATION_INCONCLUSIVE', 'SANDBOX_UNAVAILABLE'] as const;
    expect(new Set(codes.map((code) => FAILURE_PRESENTATIONS[code].title)).size).toBe(5);
    expect(new Set(codes.map((code) => FAILURE_PRESENTATIONS[code].message)).size).toBe(5);
    expect(FAILURE_PRESENTATIONS.REINCARNATION_REQUIRED.message).toBe('Generate the module first, then verify it.');
    expect(FAILURE_PRESENTATIONS.VERIFICATION_DISABLED.message).toBe('Live verification is switched off on this server. Nothing was run.');
    expect(FAILURE_PRESENTATIONS.SANDBOX_UNAVAILABLE.message).toBe('The isolated environment is not available right now. Nothing was run.');
  });

  it('R11.10 R18.11 says that an inconclusive check stored no result and may count toward the limit', () => {
    const message = FAILURE_PRESENTATIONS.VERIFICATION_INCONCLUSIVE.message;
    expect(message).toContain('No result was stored.');
    expect(message).toContain('may count toward the verification limit');
    expect(message).toContain('ran out of time or memory');
  });

  it('R11.7 says that a failed model attempt can still count toward the request limit', () => {
    for (const code of ['LLM_OUTPUT_INVALID', 'LLM_PROVIDER_ERROR', 'LLM_TIMEOUT'] as const) {
      expect(FAILURE_PRESENTATIONS[code].message).toContain('A failed attempt can still count toward your request limit.');
    }
  });

  it('R11.6 gives the specific reason in fixed words for a source that cannot be processed', () => {
    for (const code of ['SOURCE_TOO_LARGE', 'SOURCE_SYNTAX_ERROR', 'SOURCE_NOT_SCANNABLE', 'NO_ENTRY_FUNCTION'] as const) {
      expect(FAILURE_PRESENTATIONS[code].message).toContain('cannot be processed');
    }
    expect(FAILURE_PRESENTATIONS.SOURCE_TOO_LARGE.message).toContain('too large');
    expect(FAILURE_PRESENTATIONS.SOURCE_SYNTAX_ERROR.message).toContain('syntax error');
    expect(FAILURE_PRESENTATIONS.NO_ENTRY_FUNCTION.message).toContain('no entry function');
  });

  it('R11.5 offers the sign-in link only for AUTH_REQUIRED', () => {
    for (const kind of [...PIPELINE_ERROR_CODES, ...CLIENT_KINDS]) {
      expect(presentFailure(failure(kind), 'scan').signIn).toBe(kind === 'AUTH_REQUIRED');
    }
  });

  it('R11.2 gives the generic message for the client outcomes', () => {
    expect(presentFailure(failure('NETWORK'), 'scan').message).toBe('The request could not be completed. Try again later.');
    expect(presentFailure(failure('UNKNOWN'), 'scan').message).toBe('The request could not be completed. Try again later.');
    expect(presentFailure(failure('CLIENT_TIMEOUT'), 'scan').message).toContain('The request took too long.');
  });
});

describe('R11.4 R11.11 waiting failures', () => {
  it.each(['RATE_LIMITED', 'VERIFICATION_BUSY'] as const)('%s with a valid wait states it and locks the control for that long', (code) => {
    const shown = presentFailure(failure(code, 90), 'seance');
    expect(shown.waitSeconds).toBe(90);
    expect(shown.message).toContain('Try again in about 2 minutes.');
  });

  it.each(['RATE_LIMITED', 'VERIFICATION_BUSY'] as const)('%s without a valid wait says "Try again later." and does not lock', (code) => {
    const shown = presentFailure(failure(code, null), 'seance');
    expect(shown.waitSeconds).toBeNull();
    expect(shown.message).toContain('Try again later.');
  });

  it('does not lock for any other code, even when a wait is given', () => {
    expect(presentFailure(failure('NOT_FOUND', 30), 'scan').waitSeconds).toBeNull();
  });

  it('R11.4 says "request limit" for RATE_LIMITED on the model routes', () => {
    for (const route of ['scan', 'seance', 'reincarnate'] as const) {
      expect(presentFailure(failure('RATE_LIMITED', 60), route).message).toContain('The request limit was reached.');
    }
  });

  it('R11.11 says "verification limit" for RATE_LIMITED on the verification route, and keeps the wait', () => {
    const shown = presentFailure(failure('RATE_LIMITED', 3600), 'verify');
    expect(shown.message).toBe('The verification limit was reached. Try again in about 1 hour.');
    expect(shown.title).toBe('Verification limit reached');
    expect(shown.waitSeconds).toBe(3600);
  });

  it('R11.11 changes no other code for the verification route', () => {
    for (const kind of [...PIPELINE_ERROR_CODES, ...CLIENT_KINDS].filter((item) => item !== 'RATE_LIMITED')) {
      expect(presentFailure(failure(kind), 'verify')).toEqual(presentFailure(failure(kind), 'scan'));
    }
  });
});

describe('R10.2 R18.8 success messages', () => {
  it('has a fixed message for every route and source that a route sends, with no Forbidden_Term', () => {
    for (const route of ROUTES) {
      for (const source of RESULT_SOURCES[route]) {
        const message = presentSuccess(route, source);
        expect(message.trim()).not.toBe('');
        expect(containsForbiddenTerm(message)).toBe(false);
        // The scanner is deterministic and never reuses a model result, so `scan` with `cache` is the one accepted pair that
        // no route sends. It keeps the fallback text.
        if (!(route === 'scan' && source === 'cache')) expect(message).not.toBe('Done.');
      }
    }
  });

  it('R10.2 tells a precomputed result from a stored scan', () => {
    expect(presentSuccess('scan', 'precomputed')).toBe('The stored scan result is shown.');
    expect(presentSuccess('seance', 'precomputed')).toBe('The result is precomputed. Showing it.');
    expect(presentSuccess('reincarnate', 'precomputed')).toBe('The result is precomputed. Showing it.');
  });

  it('R10.2 says that a cache hit reused a stored result and made no model request', () => {
    for (const route of ['seance', 'reincarnate'] as const) {
      expect(presentSuccess(route, 'cache')).toBe('Reused a stored result for identical code. No model request was made.');
    }
  });

  it('R10.2 says that a stored stage was already complete', () => {
    expect(presentSuccess('seance', 'stored')).toBe('A séance was already stored. Showing it.');
    expect(presentSuccess('reincarnate', 'stored')).toBe('A reincarnation was already stored. Showing it.');
  });

  it('R18.8 words the three verification messages exactly', () => {
    expect(presentSuccess('verify', 'executed')).toBe('The check finished. The stored result is shown below.');
    expect(presentSuccess('verify', 'stored')).toBe('A result was already stored. Showing it.');
    expect(presentSuccess('verify', 'precomputed')).toBe('The result is precomputed. Showing it.');
  });

  it('falls back to "Done." for a pair that no route produces', () => {
    expect(presentSuccess('verify', 'generated')).toBe('Done.');
    expect(presentSuccess('seance', 'executed')).toBe('Done.');
  });
});
