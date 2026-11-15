import { CURSE_TABLE, CURSE_TYPE_ORDER } from './constants.js';
import type { LineIndex } from './line-index.js';
import type {
  CurseFinding,
  CurseType,
  FunctionSignature,
  ScanError,
  ScanErrorCode,
  ScanSuccess,
  SignaturesSuccess,
  SourceLanguage,
} from './types.js';

export interface RawFinding {
  curseType: CurseType;
  start: number;
}

const ORDER_INDEX: ReadonlyMap<CurseType, number> = new Map(CURSE_TYPE_ORDER.map((type, index) => [type, index]));

// Sorted by position, then by the Curse_Type_Order. The sort is stable, so equal keys keep the
// order in which the visitor met the nodes.
export function buildCurses(raw: readonly RawFinding[], lineIndex: LineIndex): CurseFinding[] {
  return [...raw]
    .sort((a, b) => a.start - b.start || ORDER_INDEX.get(a.curseType)! - ORDER_INDEX.get(b.curseType)!)
    .map(({ curseType, start }) => {
      const { line, column } = lineIndex.position(start);
      const info = CURSE_TABLE[curseType];
      return {
        curseType,
        severity: info.severity,
        lineNumber: line,
        column,
        description: info.description,
        exorcismStrategy: info.exorcismStrategy,
      };
    });
}

// Property order is part of the serialization contract (Requirement 11.5).
export function scanSuccess(sourceLanguage: SourceLanguage, lineCount: number, curses: CurseFinding[]): ScanSuccess {
  return { ok: true, sourceLanguage, lineCount, curses };
}

export function signaturesSuccess(
  sourceLanguage: SourceLanguage,
  lineCount: number,
  functions: FunctionSignature[],
): SignaturesSuccess {
  return { ok: true, sourceLanguage, lineCount, functions };
}

export function scanError(code: ScanErrorCode, message: string): ScanError {
  return { ok: false, code, message };
}
