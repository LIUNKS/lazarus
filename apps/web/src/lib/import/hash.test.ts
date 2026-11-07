import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normalizeNewlines, sha256Hex } from './hash';

describe('R11 code hash', () => {
  it('matches known SHA-256 digests', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hashes non-ASCII text over its UTF-8 bytes', async () => {
    expect(await sha256Hex('h\u00e9llo \u2013 \u4e16\u754c')).toBe(createHash('sha256').update('h\u00e9llo \u2013 \u4e16\u754c', 'utf8').digest('hex'));
  });

  it('gives the same hash for CR LF and LF input after normalization', async () => {
    expect(await sha256Hex(normalizeNewlines('a\r\nb\r\n'))).toBe(await sha256Hex('a\nb\n'));
  });

  it('treats CR before LF as a line ending and leaves other CR characters alone', () => {
    expect(normalizeNewlines('a\rb\r\r\nc')).toBe('a\rb\nc');
    expect(normalizeNewlines('a\rb')).toBe('a\rb');
    expect(normalizeNewlines('a\r\nb\r\n')).toBe('a\nb\n');
  });

  it('equals the node:crypto digest for any string and normalization is idempotent', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ unit: 'binary' }), async (text) => {
        const once = normalizeNewlines(text);
        expect(normalizeNewlines(once)).toBe(once);
        const safe = once.toWellFormed();
        expect(await sha256Hex(safe)).toBe(createHash('sha256').update(safe, 'utf8').digest('hex'));
      }),
    );
  });
});