import { childKeysOf } from './child-keys.js';
import { MESSAGES, WATCHED_NAMES } from './constants.js';
import { ScanAbort, type Deadline } from './deadline.js';
import { child, createDetectors, isIdentifier } from './detectors.js';
import { addMarker, FunctionTracker, toSignatures } from './functions.js';
import type { LineIndex } from './line-index.js';
import { LIMITS } from './limits.js';
import { buildCurses, type RawFinding } from './results.js';
import { ScopeTracker } from './scopes.js';
import type { CurseFinding, FunctionSignature } from './types.js';

export interface TreeNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

export type AnalysisOutcome =
  | { ok: true; curses: CurseFinding[]; functions: FunctionSignature[] }
  | { ok: false; code: 'LIMIT_EXCEEDED' | 'TIMEOUT'; message: string };

/** How a child is used by its parent. The role of each child is decided when the parent is entered. */
export type Role = 'ref' | 'skip' | 'declare' | 'write' | 'callArg';

interface Task {
  node: TreeNode;
  depth: number;
  role: Role;
  parent: TreeNode | null;
  exit: boolean;
}

function roleOf(parent: TreeNode, key: string, node: TreeNode): Role {
  switch (parent.type) {
    case 'MemberExpression':
      return key === 'property' && parent.computed !== true ? 'skip' : 'ref';
    case 'Property':
      return key === 'key' ? 'skip' : 'ref';
    case 'LabeledStatement':
      return key === 'label' ? 'skip' : 'ref';
    case 'BreakStatement':
    case 'ContinueStatement':
      return 'skip';
    case 'FunctionDeclaration':
    case 'FunctionExpression':
      return key === 'body' ? 'ref' : 'declare';
    case 'VariableDeclarator':
      return key === 'id' ? 'declare' : 'ref';
    case 'CatchClause':
      return key === 'param' ? 'declare' : 'ref';
    case 'AssignmentExpression':
      return key === 'left' && node.type === 'Identifier' ? 'write' : 'ref';
    case 'UpdateExpression':
      return node.type === 'Identifier' ? 'write' : 'ref';
    case 'ForInStatement':
      // The loop variable is not an assignment (Requirement 4.6).
      return key === 'left' && node.type === 'Identifier' ? 'skip' : 'ref';
    case 'CallExpression':
    case 'NewExpression':
      return key === 'arguments' ? 'callArg' : 'ref';
    default:
      return 'ref';
  }
}

function isTreeNode(value: unknown): value is TreeNode {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

function nameOf(node: TreeNode | null): string | null {
  return node !== null && node.type === 'Identifier' && typeof node.name === 'string' ? node.name : null;
}

// `var name = function () {}` and `name = function () {}` give the function the name on the left.
function inferName(node: TreeNode, parent: TreeNode | null): string | null {
  if (parent === null) return null;
  if (parent.type === 'VariableDeclarator' && parent.init === node) return nameOf(child(parent, 'id'));
  if (parent.type === 'AssignmentExpression' && parent.operator === '=' && parent.right === node) {
    return nameOf(child(parent, 'left'));
  }
  return null;
}

function isMathRandom(node: TreeNode): boolean {
  if (!isIdentifier(child(node, 'object'), 'Math')) return false;
  const property = child(node, 'property');
  if (property === null) return false;
  return node.computed === true
    ? property.type === 'Literal' && property.value === 'random'
    : isIdentifier(property, 'random');
}

/**
 * Single iterative pass over a tree. It enforces the node and depth limits on any tree it is
 * given, so no analysis function recurses over the tree.
 */
export function analyzeTree(tree: TreeNode, lineIndex: LineIndex, deadline: Deadline): AnalysisOutcome {
  const findings: RawFinding[] = [];
  const functions = new FunctionTracker();
  const scopes = new ScopeTracker({
    recordGlobalPollution: (start) => findings.push({ curseType: 'GLOBAL_POLLUTION', start }),
  });
  const detectors = createDetectors({
    record: (curseType, start) => findings.push({ curseType, start }),
    onEval: () => addMarker(functions.current, null, 'DYNAMIC_CODE'),
    onGlobalMemberWrite: () => addMarker(functions.current, null, 'GLOBAL_WRITE'),
  });

  const enterFunction = (node: TreeNode, parent: TreeNode | null): void => {
    const idName = nameOf(child(node, 'id'));
    const kind = node.type === 'FunctionDeclaration' ? 'declaration' : 'expression';
    if (kind === 'declaration' && idName !== null) scopes.declareVar(idName);

    const params = Array.isArray(node.params) ? node.params.map((param) => nameOf(param as TreeNode) ?? '') : [];
    const fn = functions.enter(node, kind, idName ?? inferName(node, parent), params);
    const declared = [...params, 'arguments'];
    if (kind === 'expression' && idName !== null) declared.push(idName);
    scopes.pushFunction(fn, declared);
  };

  const enterIdentifier = (node: TreeNode, role: Role, parent: TreeNode | null): void => {
    const name = node.name;
    if (typeof name !== 'string') return;
    // A direct call argument is a reference too (`callArg` only adds the callback rule).
    if (role === 'ref' || role === 'callArg') {
      const marker = WATCHED_NAMES.get(name);
      if (marker !== undefined) {
        scopes.queue({ name, kind: 'read', start: node.start, originFn: functions.current, marker, reportPollution: false });
      }
    } else if (role === 'write') {
      const isAssignment = parent !== null && parent.type === 'AssignmentExpression';
      scopes.queue({
        name,
        kind: 'write',
        start: isAssignment ? parent.start : node.start,
        originFn: functions.current,
        marker: null,
        reportPollution: isAssignment,
      });
    }
  };

  const onEnter = ({ node, role, parent }: Task): void => {
    switch (node.type) {
      case 'Program':
        scopes.pushProgram();
        break;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
        enterFunction(node, parent);
        break;
      case 'VariableDeclarator': {
        const name = nameOf(child(node, 'id'));
        if (name !== null) scopes.declareVar(name);
        break;
      }
      case 'CatchClause':
        scopes.pushCatch(functions.current, nameOf(child(node, 'param')));
        break;
      case 'Identifier':
        enterIdentifier(node, role, parent);
        break;
      case 'MemberExpression':
        if (isMathRandom(node)) {
          scopes.queue({
            name: 'Math',
            kind: 'read',
            start: node.start,
            originFn: functions.current,
            marker: 'NONDETERMINISTIC_API',
            reportPollution: false,
          });
        }
        break;
      default:
        break;
    }
    detectors.enter(node, role);
  };

  const onExit = ({ node, role }: Task): void => {
    detectors.exit(node, role);
    switch (node.type) {
      case 'FunctionDeclaration':
      case 'FunctionExpression':
        scopes.pop();
        functions.exit();
        break;
      case 'CatchClause':
      case 'Program':
        scopes.pop();
        break;
      default:
        break;
    }
  };

  const stack: Task[] = [{ node: tree, depth: 1, role: 'ref', parent: null, exit: false }];
  let nodeCount = 0;

  try {
    deadline.check();
    while (stack.length > 0) {
      const task = stack.pop()!;
      if (task.exit) {
        onExit(task);
        continue;
      }

      nodeCount++;
      if (nodeCount > LIMITS.nodes || task.depth > LIMITS.depth) {
        return { ok: false, code: 'LIMIT_EXCEEDED', message: MESSAGES.treeLimit };
      }
      deadline.step();

      const keys = childKeysOf(task.node.type);
      if (keys === undefined) throw new Error('Unknown node type');
      onEnter(task);

      task.exit = true;
      stack.push(task);
      // Children are pushed in reverse so they pop in source order.
      for (let k = keys.length - 1; k >= 0; k--) {
        const key = keys[k]!;
        const value = task.node[key];
        if (Array.isArray(value)) {
          for (let i = value.length - 1; i >= 0; i--) {
            const item: unknown = value[i];
            if (isTreeNode(item)) {
              stack.push({ node: item, depth: task.depth + 1, role: roleOf(task.node, key, item), parent: task.node, exit: false });
            }
          }
        } else if (isTreeNode(value)) {
          stack.push({ node: value, depth: task.depth + 1, role: roleOf(task.node, key, value), parent: task.node, exit: false });
        }
      }
    }
  } catch (error) {
    if (error instanceof ScanAbort) return { ok: false, code: 'TIMEOUT', message: MESSAGES.timeout };
    throw error;
  }

  return { ok: true, curses: buildCurses(findings, lineIndex), functions: toSignatures(functions.all, lineIndex) };
}
