import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractFunctionSignatures, scanCurses } from '../../src/lib.ts';
import { loadSeedSamples } from '../support/seed-loader.ts';
import { workspaceRoot } from '../support/paths.ts';

const dbDir = join(workspaceRoot, 'db');

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : filesUnder(path);
    return [path];
  });
}

/** SHA-256 of every file under db/, keyed by the path relative to the Workspace_Root. */
function snapshot(): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const file of filesUnder(dbDir).sort()) {
    hashes.set(relative(workspaceRoot, file).replace(/\\/g, '/'), createHash('sha256').update(readFileSync(file)).digest('hex'));
  }
  return hashes;
}

let before: Map<string, string>;
beforeAll(() => {
  before = snapshot();
});

afterAll(() => {
  // A change after the run starts would break the next run's baseline, so it fails here as well.
  expect(snapshot()).toEqual(before);
});

describe('db/ stays untouched by the agreement run', () => {
  it('R17.10 R20.2 the agreement scans leave every file under db/ byte-identical', () => {
    expect(before.size).toBeGreaterThan(0);
    const { samples } = loadSeedSamples();
    for (const sample of samples) {
      scanCurses(sample.legacy, sample.sourceLanguage);
      extractFunctionSignatures(sample.legacy, sample.sourceLanguage);
    }
    expect(snapshot()).toEqual(before);
  });
});
