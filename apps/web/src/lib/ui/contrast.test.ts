import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.resolve(import.meta.dirname, '../../app/globals.css'), 'utf8');

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
  if (!match) throw new Error(`Token --${name} not found in globals.css`);
  return (match[1] as string).toLowerCase();
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe('R3 Theme_Tokens', () => {
  it('uses the specified palette', () => {
    expect(token('background')).toBe('#09090b');
    expect(token('curse')).toBe('#e11d48');
    expect(token('verified')).toBe('#10b981');
    expect(token('destructive')).toBe('#e11d48');
    expect(css).toContain('color-scheme: dark');
  });

  it.each([
    ['foreground', 'background'],
    ['foreground', 'card'],
    ['foreground', 'secondary'],
    ['foreground', 'accent'],
    ['muted-foreground', 'background'],
    ['muted-foreground', 'card'],
    ['muted-foreground', 'muted'],
    ['primary-foreground', 'primary'],
    ['curse-foreground', 'curse'],
    ['verified-foreground', 'verified'],
    ['verified', 'background'],
    ['ring', 'background'],
  ])('keeps %s on %s at or above 4.5:1', (foreground, background) => {
    expect(contrast(token(foreground), token(background))).toBeGreaterThanOrEqual(4.5);
  });
});