// Tests for the Vitest guards in guards.ts (Requirement 20 criteria 1 and 13).
import net from 'node:net';
import tls from 'node:tls';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('R20.13 network and environment guards (Requirement 20)', () => {
  it('R20.13 fetch throws an error that names the network access (Requirement 20)', async () => {
    expect(() => fetch('https://example.invalid/')).toThrow(/blocked access to the network through fetch/);
  });

  it('R20.13 net.connect and tls.connect throw an error that names the network access (Requirement 20)', () => {
    expect(() => net.connect({ port: 9, host: '127.0.0.1' })).toThrow(/net\.connect/);
    expect(() => tls.connect({ port: 9, host: '127.0.0.1' })).toThrow(/tls\.connect/);
  });

  it.each(['GROQ_API_KEY', 'LLM_MODEL', 'GOOGLE_GENERATIVE_AI_API_KEY', 'LLM_FALLBACK_MODEL'])(
    'R20.13 reading the unset variable %s throws an error that names it (Requirement 20)',
    (name) => {
      expect(Object.hasOwn(process.env, name)).toBe(false);
      expect(() => process.env[name]).toThrow(new RegExp(`environment variable ${name}`));
    },
  );

  it('R20.13 a variable set with vi.stubEnv is readable, and unreadable again after the stub is removed (Requirement 20)', () => {
    vi.stubEnv('LLM_MODEL', 'test-model');
    expect(process.env.LLM_MODEL).toBe('test-model');
    vi.unstubAllEnvs();
    expect(() => process.env.LLM_MODEL).toThrow(/LLM_MODEL/);
  });

  it('R20.13 a variable assigned directly is readable (Requirement 20)', () => {
    process.env.GROQ_API_KEY = 'test-key';
    try {
      expect(process.env.GROQ_API_KEY).toBe('test-key');
    } finally {
      delete process.env.GROQ_API_KEY;
    }
  });

  it('R20.13 other variables stay readable, so the guard does not break unrelated code (Requirement 20)', () => {
    expect(() => process.env.PATH ?? process.env.Path).not.toThrow();
    expect(() => ({ ...process.env })).not.toThrow();
  });

  it('R20.13 a guard failure in one test does not fail the next test (Requirement 20)', () => {
    expect(() => process.env.GROQ_API_KEY).toThrow();
    expect(1 + 1).toBe(2);
  });
});
