export type SourceLanguage = 'es3' | 'es5-jquery' | 'legacy-node';

export type CurseType =
  | 'GLOBAL_POLLUTION'
  | 'VAR_HOISTING'
  | 'IMPLICIT_COERCION'
  | 'CALLBACK_HELL'
  | 'EVAL_INJECTION'
  | 'PROTOTYPE_POLLUTION';

export type Severity = 'HEX' | 'BLOOD_CURSE' | 'FATAL';

export type ImpurityMarker =
  | 'GLOBAL_WRITE'
  | 'OUTER_SCOPE_WRITE'
  | 'NONDETERMINISTIC_API'
  | 'TIMER_API'
  | 'ENVIRONMENT_API'
  | 'DYNAMIC_CODE';

export type ScanErrorCode =
  | 'INVALID_INPUT'
  | 'INPUT_TOO_LARGE'
  | 'SYNTAX_ERROR'
  | 'LIMIT_EXCEEDED'
  | 'TIMEOUT';

// Property order is the declaration order (it is part of the serialization contract).
export interface CurseFinding {
  curseType: CurseType;
  severity: Severity;
  lineNumber: number;
  column: number;
  description: string;
  exorcismStrategy: string;
}

export interface FunctionSignature {
  name: string | null;
  kind: 'declaration' | 'expression';
  params: string[];
  startLine: number;
  startColumn: number;
  endLine: number;
  nestingDepth: number;
  pureCandidate: boolean;
  impurityMarkers: ImpurityMarker[];
}

export interface ScanSuccess {
  ok: true;
  sourceLanguage: SourceLanguage;
  lineCount: number;
  curses: CurseFinding[];
}

export interface SignaturesSuccess {
  ok: true;
  sourceLanguage: SourceLanguage;
  lineCount: number;
  functions: FunctionSignature[];
}

export interface ScanError {
  ok: false;
  code: ScanErrorCode;
  message: string;
  line?: number;
  column?: number;
}

export type ScanResult = ScanSuccess | ScanError;
export type SignaturesResult = SignaturesSuccess | ScanError;
