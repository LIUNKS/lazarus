import type { CurseType } from './types.js';
import type { Role, TreeNode } from './visit.js';

export interface DetectorContext {
  /** Records a finding at the start offset of a node. */
  record(curseType: CurseType, start: number): void;
  /** Called for every EVAL_INJECTION finding (feeds the DYNAMIC_CODE marker). */
  onEval(): void;
  /** Called for an assignment to a member of window or global (feeds GLOBAL_WRITE). */
  onGlobalMemberWrite(): void;
}

export interface Detectors {
  enter(node: TreeNode, role: Role): void;
  exit(node: TreeNode, role: Role): void;
}

export function child(node: TreeNode, key: string): TreeNode | null {
  const value = node[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as TreeNode) : null;
}

export function isIdentifier(node: TreeNode | null, name?: string): node is TreeNode {
  return node !== null && node.type === 'Identifier' && (name === undefined || node.name === name);
}

function isStringLiteral(node: TreeNode | null, value?: string): boolean {
  return node !== null && node.type === 'Literal' && typeof node.value === 'string' && (value === undefined || node.value === value);
}

function isNumberLiteral(node: TreeNode | null): boolean {
  return node !== null && node.type === 'Literal' && typeof node.value === 'number';
}

export function createDetectors(ctx: DetectorContext): Detectors {
  // Number of callback ancestors of the node being entered.
  let callbackDepth = 0;

  const isCallback = (node: TreeNode, role: Role): boolean =>
    node.type === 'FunctionExpression' && role === 'callArg';

  const detectAssignment = (node: TreeNode): void => {
    const left = child(node, 'left');
    if (left === null || left.type !== 'MemberExpression') return;
    const object = child(left, 'object');
    const property = child(left, 'property');
    const computed = left.computed === true;

    if (isIdentifier(object, 'window') || isIdentifier(object, 'global')) {
      ctx.record('GLOBAL_POLLUTION', node.start);
      ctx.onGlobalMemberWrite();
    }

    const protoKey = computed ? isStringLiteral(property, '__proto__') : isIdentifier(property, '__proto__');
    const dynamicKey = computed && !isStringLiteral(property) && !isNumberLiteral(property);
    if (protoKey || dynamicKey) ctx.record('PROTOTYPE_POLLUTION', node.start);
  };

  return {
    enter(node, role) {
      switch (node.type) {
        case 'VariableDeclaration':
          if (node.kind === 'var') ctx.record('VAR_HOISTING', node.start);
          break;
        case 'BinaryExpression':
          if (node.operator === '==' || node.operator === '!=') ctx.record('IMPLICIT_COERCION', node.start);
          break;
        case 'CallExpression': {
          const callee = child(node, 'callee');
          if (isIdentifier(callee, 'eval') || isIdentifier(callee, 'Function')) {
            ctx.record('EVAL_INJECTION', node.start);
            ctx.onEval();
          }
          break;
        }
        case 'NewExpression':
          if (isIdentifier(child(node, 'callee'), 'Function')) {
            ctx.record('EVAL_INJECTION', node.start);
            ctx.onEval();
          }
          break;
        case 'AssignmentExpression':
          detectAssignment(node);
          break;
        case 'FunctionExpression':
          if (isCallback(node, role)) {
            if (callbackDepth >= 2) ctx.record('CALLBACK_HELL', node.start);
            callbackDepth++;
          }
          break;
        default:
          break;
      }
    },
    exit(node, role) {
      if (isCallback(node, role)) callbackDepth--;
    },
  };
}
