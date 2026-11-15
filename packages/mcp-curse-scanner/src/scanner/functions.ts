import { IMPURITY_MARKER_ORDER } from './constants.js';
import type { LineIndex } from './line-index.js';
import type { FunctionSignature, ImpurityMarker } from './types.js';
import type { TreeNode } from './visit.js';

export interface FunctionInfo {
  node: TreeNode;
  name: string | null;
  kind: 'declaration' | 'expression';
  params: string[];
  nestingDepth: number;
  parent: FunctionInfo | null;
  markers: Set<ImpurityMarker>;
}

/** Adds a marker to every function from `from` up to, but not including, `stop` (null = the root). */
export function addMarker(from: FunctionInfo | null, stop: FunctionInfo | null, marker: ImpurityMarker): void {
  for (let fn = from; fn !== null && fn !== stop; fn = fn.parent) fn.markers.add(marker);
}

export class FunctionTracker {
  current: FunctionInfo | null = null;
  readonly all: FunctionInfo[] = [];

  enter(node: TreeNode, kind: FunctionInfo['kind'], name: string | null, params: string[]): FunctionInfo {
    const info: FunctionInfo = {
      node,
      name,
      kind,
      params,
      nestingDepth: this.current === null ? 0 : this.current.nestingDepth + 1,
      parent: this.current,
      markers: new Set(),
    };
    this.all.push(info);
    this.current = info;
    return info;
  }

  exit(): void {
    if (this.current !== null) this.current = this.current.parent;
  }
}

export function toSignatures(functions: readonly FunctionInfo[], lineIndex: LineIndex): FunctionSignature[] {
  return [...functions]
    .sort((a, b) => a.node.start - b.node.start)
    .map((fn): FunctionSignature => {
      const start = lineIndex.position(fn.node.start);
      const impurityMarkers = IMPURITY_MARKER_ORDER.filter((marker) => fn.markers.has(marker));
      return {
        name: fn.name,
        kind: fn.kind,
        params: fn.params,
        startLine: start.line,
        startColumn: start.column,
        endLine: lineIndex.position(Math.max(fn.node.end - 1, fn.node.start)).line,
        nestingDepth: fn.nestingDepth,
        pureCandidate: impurityMarkers.length === 0,
        impurityMarkers,
      };
    });
}
