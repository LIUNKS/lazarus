import { runScan } from './scanner/scan.js';
import type {
  ScanResult,
  SignaturesResult,
  SourceLanguage,
} from './scanner/types.js';

export type {
  CurseFinding,
  CurseType,
  FunctionSignature,
  ImpurityMarker,
  ScanError,
  ScanErrorCode,
  ScanResult,
  ScanSuccess,
  Severity,
  SignaturesResult,
  SignaturesSuccess,
  SourceLanguage,
} from './scanner/types.js';
export { LIMITS } from './scanner/limits.js';

export function scanCurses(source: string, sourceLanguage: SourceLanguage): ScanResult {
  return runScan(source, sourceLanguage, 'curses') as ScanResult;
}

export function extractFunctionSignatures(source: string, sourceLanguage: SourceLanguage): SignaturesResult {
  return runScan(source, sourceLanguage, 'functions') as SignaturesResult;
}
