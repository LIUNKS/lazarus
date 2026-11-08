import * as acorn from 'acorn';
import { Es3Parser } from '../../src/scanner/es3-reserved.ts';
import { levelsForDepth, SHAPE_NAMES, SHAPES, type ShapeName } from './shapes.ts';

export type Outcome = 'parsed-exact' | 'depth-mismatch' | 'parse-failed';
export type Language = 'es3' | 'es5-jquery';

export interface DepthCapability {
  nodeVersion: string;
  acornVersion: string;
  /** Outcome per construct, language, and target depth. */
  outcomes: Record<ShapeName, Record<Language, Record<512 | 513, Outcome>>>;
  /** Constructs for which the 512 and the 513 source are `parsed-exact` in both languages. */
  usable512: ShapeName[];
}

interface Measured {
  depth: number;
  nodes: number;
}

// Independent iterative walk: depth counts nodes on the longest path, Program is depth 1.
export function measureTree(root: unknown): Measured {
  let depth = 0;
  let nodes = 0;
  const stack: [unknown, number][] = [[root, 1]];
  while (stack.length > 0) {
    const [value, level] = stack.pop()!;
    if (Array.isArray(value)) {
      for (const item of value) stack.push([item, level]);
    } else if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>;
      if (typeof record.type !== 'string') continue;
      nodes++;
      depth = Math.max(depth, level);
      for (const child of Object.values(record)) stack.push([child, level + 1]);
    }
  }
  return { depth, nodes };
}

export function parseDirect(source: string, language: Language): unknown {
  const options: acorn.Options = { ecmaVersion: language === 'es3' ? 3 : 5, sourceType: 'script' };
  return language === 'es3' ? Es3Parser.parse(source, { ...options, allowReserved: false }) : acorn.parse(source, options);
}

function attempt(shape: ShapeName, depth: 512 | 513, language: Language): Outcome {
  const definition = SHAPES[shape];
  const source = definition.build(levelsForDepth(definition, depth));
  try {
    return measureTree(parseDirect(source, language)).depth === depth ? 'parsed-exact' : 'depth-mismatch';
  } catch {
    return 'parse-failed';
  }
}

export function measureDepthCapability(): DepthCapability {
  const outcomes = {} as DepthCapability['outcomes'];
  const usable512: ShapeName[] = [];
  for (const shape of SHAPE_NAMES) {
    const perLanguage = {} as DepthCapability['outcomes'][ShapeName];
    for (const language of ['es3', 'es5-jquery'] as const) {
      perLanguage[language] = { 512: attempt(shape, 512, language), 513: attempt(shape, 513, language) };
    }
    outcomes[shape] = perLanguage;
    const exact = (['es3', 'es5-jquery'] as const).every(
      (language) => perLanguage[language][512] === 'parsed-exact' && perLanguage[language][513] === 'parsed-exact',
    );
    if (exact) usable512.push(shape);
  }
  return { nodeVersion: process.version, acornVersion: acorn.version, outcomes, usable512 };
}
