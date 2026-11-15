import { addMarker, type FunctionInfo } from './functions.js';
import type { ImpurityMarker } from './types.js';

export interface PendingItem {
  name: string;
  kind: 'read' | 'write';
  /** Start offset reported for a GLOBAL_POLLUTION finding (the assignment expression). */
  start: number;
  originFn: FunctionInfo | null;
  /** Marker added when a read stays unresolved. */
  marker: ImpurityMarker | null;
  /** True for an assignment expression, false for an update expression. */
  reportPollution: boolean;
}

interface Scope {
  kind: 'program' | 'function' | 'catch';
  declared: Set<string>;
  parent: Scope | null;
  fn: FunctionInfo | null;
  pending: PendingItem[];
}

export interface ScopeSink {
  recordGlobalPollution(start: number): void;
}

// Names resolve when a scope closes, so a declaration after its use still counts (hoisting).
export class ScopeTracker {
  private current: Scope | null = null;

  constructor(private readonly sink: ScopeSink) {}

  pushProgram(): void {
    this.push('program', [], null);
  }

  pushFunction(fn: FunctionInfo, declared: readonly string[]): void {
    this.push('function', declared, fn);
  }

  pushCatch(fn: FunctionInfo | null, param: string | null): void {
    this.push('catch', param === null ? [] : [param], fn);
  }

  /** Declares a name in the nearest function or program scope (`var`, function declaration). */
  declareVar(name: string): void {
    let scope = this.current;
    while (scope !== null && scope.kind === 'catch') scope = scope.parent;
    scope?.declared.add(name);
  }

  queue(item: PendingItem): void {
    this.current?.pending.push(item);
  }

  pop(): void {
    const scope = this.current;
    if (scope === null) return;
    this.current = scope.parent;

    for (const item of scope.pending) {
      if (scope.declared.has(item.name)) {
        if (item.kind === 'write') addMarker(item.originFn, scope.fn, 'OUTER_SCOPE_WRITE');
      } else if (scope.parent !== null) {
        scope.parent.pending.push(item);
      } else if (item.kind === 'write') {
        addMarker(item.originFn, null, 'GLOBAL_WRITE');
        if (item.reportPollution) this.sink.recordGlobalPollution(item.start);
      } else if (item.marker !== null) {
        addMarker(item.originFn, null, item.marker);
      }
    }
  }

  private push(kind: Scope['kind'], declared: readonly string[], fn: FunctionInfo | null): void {
    this.current = { kind, declared: new Set(declared), parent: this.current, fn, pending: [] };
  }
}
