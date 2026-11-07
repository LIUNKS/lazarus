import { describe, expect, it } from 'vitest';
import { measureDepthCapability, measureTree, parseDirect } from '../support/depth-capability.ts';
import { flatList, SHAPE_NAMES } from '../support/shapes.ts';

const BASELINE = ['member-chain', 'call-chain'];
const capability = measureDepthCapability();

describe('depth-512 capability', () => {
  it('R18.8 depth-512 capability record is complete and reported', () => {
    for (const shape of SHAPE_NAMES) {
      for (const language of ['es3', 'es5-jquery'] as const) {
        for (const depth of [512, 513] as const) {
          expect(capability.outcomes[shape]?.[language]?.[depth], `${shape} ${language} ${depth}`).toBeDefined();
        }
      }
    }

    console.info(
      `depth-512 capability: usable = [${capability.usable512.join(', ')}]; acorn ${capability.acornVersion}; node ${capability.nodeVersion}`,
    );

    const gained = capability.usable512.filter((name) => !BASELINE.includes(name));
    const lost = BASELINE.filter((name) => !capability.usable512.includes(name as never));
    if (gained.length > 0 || lost.length > 0) {
      const detail = lost
        .map((name) => `${name} -> ${JSON.stringify(capability.outcomes[name as keyof typeof capability.outcomes])}`)
        .join('; ');
      console.info(
        `WARN depth-512 capability changed: gained [${gained.join(', ')}], lost [${lost.join(', ')}] ${detail}; acorn ${capability.acornVersion}; node ${capability.nodeVersion}`,
      );
    }
  });

  it('R18.8 the node-count boundary parses with exactly 200,000 and 200,001 nodes', () => {
    const context = `acorn ${capability.acornVersion}, node ${capability.nodeVersion}`;
    const atLimit = measureTree(parseDirect(flatList(199_999), 'es5-jquery'));
    expect(atLimit, `';'.repeat(199_999) must have 200,000 nodes and depth 2 (${context})`).toEqual({
      nodes: 200_000,
      depth: 2,
    });
    const overLimit = measureTree(parseDirect(flatList(200_000), 'es5-jquery'));
    expect(overLimit.nodes, `';'.repeat(200_000) must have 200,001 nodes (${context})`).toBe(200_001);
  });
});
