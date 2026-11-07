// Small ES3/ES5 static analysis helpers built on acorn, used to verify the sample corpses.
import * as acorn from 'acorn';

export interface AstNode {
  type: string;
  start: number;
  end: number;
  loc: { start: { line: number }; end: { line: number } };
  [key: string]: unknown;
}

export function parseScript(code: string, ecmaVersion: 3 | 5): AstNode {
  return acorn.parse(code, { ecmaVersion, sourceType: 'script', locations: true }) as unknown as AstNode;
}

function isNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

export function childrenOf(node: AstNode): Array<{ key: string; node: AstNode }> {
  const result: Array<{ key: string; node: AstNode }> = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc') continue;
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) result.push({ key, node: item });
    } else if (isNode(value)) {
      result.push({ key, node: value });
    }
  }
  return result;
}

export type Visitor = (node: AstNode, ancestors: AstNode[], key: string) => void;

export function walk(node: AstNode, visit: Visitor, ancestors: AstNode[] = [], key = ''): void {
  visit(node, ancestors, key);
  for (const child of childrenOf(node)) walk(child.node, visit, [...ancestors, node], child.key);
}

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression']);

export function isFunction(node: AstNode): boolean {
  return FUNCTION_TYPES.has(node.type);
}

function nameOf(node: unknown): string | undefined {
  return isNode(node) && node.type === 'Identifier' ? (node['name'] as string) : undefined;
}

/** Names declared directly in a function or program scope (var, function declarations, params, catch params). */
export function declaredNames(scope: AstNode): Set<string> {
  const names = new Set<string>();
  if (isFunction(scope)) {
    for (const param of (scope['params'] as AstNode[]) ?? []) {
      const name = nameOf(param);
      if (name) names.add(name);
    }
    const ownName = nameOf(scope['id']);
    if (ownName) names.add(ownName);
    names.add('arguments');
  }
  const visit = (node: AstNode): void => {
    for (const { node: child } of childrenOf(node)) {
      if (child.type === 'FunctionDeclaration') {
        const name = nameOf(child['id']);
        if (name) names.add(name);
        continue; // do not descend into nested functions
      }
      if (child.type === 'FunctionExpression') continue;
      if (child.type === 'VariableDeclarator') {
        const name = nameOf(child['id']);
        if (name) names.add(name);
      }
      if (child.type === 'CatchClause') {
        const name = nameOf(child['param']);
        if (name) names.add(name);
      }
      visit(child);
    }
  };
  visit(isFunction(scope) ? (scope['body'] as AstNode) : scope);
  return names;
}

export function isDeclared(name: string, ancestors: AstNode[]): boolean {
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const scope = ancestors[i] as AstNode;
    if ((isFunction(scope) || scope.type === 'Program') && declaredNames(scope).has(name)) return true;
  }
  return false;
}

export function topLevelFunctions(program: AstNode): string[] {
  return (program['body'] as AstNode[]).filter((n) => n.type === 'FunctionDeclaration').map((n) => nameOf(n['id']) ?? '');
}

export function topLevelFunction(program: AstNode, name: string): AstNode | undefined {
  return (program['body'] as AstNode[]).find((n) => n.type === 'FunctionDeclaration' && nameOf(n['id']) === name);
}

export interface FunctionEffects {
  freeReads: Set<string>;
  freeWrites: Set<string>;
}

/** Finds identifiers that a function reads or writes without declaring them in its own scope chain. */
export function functionEffects(fn: AstNode): FunctionEffects {
  const freeReads = new Set<string>();
  const freeWrites = new Set<string>();
  const rootOf = (node: unknown): string | undefined => {
    let current: unknown = node;
    while (isNode(current) && current.type === 'MemberExpression') current = current['object'];
    return nameOf(current);
  };

  walk(fn, (node, ancestors, key) => {
    const scopes = [...ancestors, node];
    if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
      const target = node.type === 'AssignmentExpression' ? node['left'] : node['argument'];
      const root = rootOf(target);
      if (root && !isDeclared(root, scopes)) freeWrites.add(root);
    }
    if (node.type !== 'Identifier') return;
    const parent = ancestors[ancestors.length - 1];
    if (!parent) return;
    const name = node['name'] as string;
    if (parent.type === 'MemberExpression' && key === 'property' && !parent['computed']) return;
    if (parent.type === 'Property' && key === 'key' && !parent['computed']) return;
    if (isFunction(parent) && (key === 'id' || key === 'params')) return;
    if (parent.type === 'VariableDeclarator' && key === 'id') return;
    if (parent.type === 'CatchClause' && key === 'param') return;
    if (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') return;
    if (!isDeclared(name, scopes)) freeReads.add(name);
  });
  return { freeReads, freeWrites };
}

/** Lines (1-based) of every node that matches, grouped for the curse checks. */
export function nodesStartingOnLine(program: AstNode, line: number): Array<{ node: AstNode; ancestors: AstNode[] }> {
  const found: Array<{ node: AstNode; ancestors: AstNode[] }> = [];
  walk(program, (node, ancestors) => {
    if (node.loc.start.line === line) found.push({ node, ancestors });
  });
  return found;
}

const ASSIGNMENT_OPERATORS = new Set(['=', '+=', '-=', '*=', '/=', '%=']);

export type CurseType =
  | 'GLOBAL_POLLUTION'
  | 'VAR_HOISTING'
  | 'IMPLICIT_COERCION'
  | 'CALLBACK_HELL'
  | 'EVAL_INJECTION'
  | 'PROTOTYPE_POLLUTION';

/** True when the given line contains a construct of the curse type (Requirement 18.4). */
export function lineHasCurse(program: AstNode, line: number, type: CurseType): boolean {
  const candidates = nodesStartingOnLine(program, line);
  return candidates.some(({ node, ancestors }) => {
    const scopes = [...ancestors, node];
    switch (type) {
      case 'GLOBAL_POLLUTION': {
        if (node.type !== 'AssignmentExpression' || !ASSIGNMENT_OPERATORS.has(node['operator'] as string)) return false;
        const left = node['left'] as AstNode;
        const name = nameOf(left);
        if (name) return !isDeclared(name, scopes);
        if (left.type === 'MemberExpression') {
          const root = nameOf(left['object']);
          return root === 'window' || root === 'global';
        }
        return false;
      }
      case 'VAR_HOISTING':
        return node.type === 'VariableDeclaration' && node['kind'] === 'var';
      case 'IMPLICIT_COERCION':
        return node.type === 'BinaryExpression' && (node['operator'] === '==' || node['operator'] === '!=');
      case 'CALLBACK_HELL': {
        if (node.type !== 'FunctionExpression') return false;
        const isCallback = (fn: AstNode, parent: AstNode | undefined): boolean =>
          fn.type === 'FunctionExpression' &&
          parent !== undefined &&
          (parent.type === 'CallExpression' || parent.type === 'NewExpression') &&
          (parent['arguments'] as AstNode[]).includes(fn);
        if (!isCallback(node, ancestors[ancestors.length - 1])) return false;
        let nestedIn = 0;
        for (let i = ancestors.length - 1; i >= 1; i -= 1) {
          const ancestor = ancestors[i] as AstNode;
          if (isCallback(ancestor, ancestors[i - 1])) nestedIn += 1;
        }
        return nestedIn >= 2;
      }
      case 'EVAL_INJECTION':
        return (
          (node.type === 'CallExpression' && nameOf(node['callee']) === 'eval') ||
          (node.type === 'NewExpression' && nameOf(node['callee']) === 'Function')
        );
      case 'PROTOTYPE_POLLUTION': {
        if (node.type !== 'AssignmentExpression') return false;
        const left = node['left'] as AstNode;
        if (left.type !== 'MemberExpression') return false;
        const property = left['property'] as AstNode;
        if (!left['computed']) return nameOf(property) === '__proto__';
        return property.type === 'Identifier' || (property.type === 'Literal' && property['value'] === '__proto__');
      }
      default:
        return false;
    }
  });
}
