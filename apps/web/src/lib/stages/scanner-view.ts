// The view model of the Hex Scanner panel (Requirement 3). Pure module: no framework imports, no process.env.
import type { CurseRow } from '@/lib/data/types';

/** Severities from the most to the least serious. */
const SEVERITY_ORDER = ['FATAL', 'BLOOD_CURSE', 'HEX'] as const;

export interface ScannerEntry {
  id: string;
  label: string;
  curseType: string;
  severity: string;
  lineNumber: number;
  /** `source-line-N` when the line exists in the source, otherwise null (the line number is then plain text). */
  anchor: string | null;
  description: string;
  strategy: string;
}

export interface ScannerView {
  total: number;
  bySeverity: Array<{ severity: string; count: number }>;
  byType: Array<{ curseType: string; label: string; count: number }>;
  entries: ScannerEntry[];
  /** The lines of the source (1 to lineCount) that have at least one curse. */
  markedLines: ReadonlySet<number>;
}

/** `GLOBAL_POLLUTION` becomes "Global pollution". */
export function curseLabel(curseType: string): string {
  const words = curseType.toLowerCase().split('_').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `BLOOD_CURSE` becomes "BLOOD CURSE". The severity is always shown as text, so color is never the only signal. */
export function severityLabel(severity: string): string {
  return severity.split('_').join(' ');
}

/**
 * The number of lines `CodeView` shows for a source: it splits on newlines, and a trailing newline ends the last line
 * instead of starting another one. `CodeView` calls this function, so the two always agree.
 */
export function countSourceLines(code: string): number {
  const lines = code.split('\n');
  return lines.length > 1 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function lineExists(lineNumber: number, lineCount: number): boolean {
  return Number.isInteger(lineNumber) && lineNumber >= 1 && lineNumber <= lineCount;
}

export function buildScannerView(curses: readonly CurseRow[], lineCount: number): ScannerView {
  const entries: ScannerEntry[] = curses
    .map((curse) => ({
      id: curse.id,
      label: curseLabel(curse.curseType),
      curseType: curse.curseType,
      severity: curse.severity,
      lineNumber: curse.lineNumber,
      anchor: lineExists(curse.lineNumber, lineCount) ? `source-line-${curse.lineNumber}` : null,
      description: curse.description,
      strategy: curse.exorcismStrategy,
    }))
    .sort((a, b) => a.lineNumber - b.lineNumber || compareText(a.curseType, b.curseType) || compareText(a.id, b.id));

  const severityCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  const markedLines = new Set<number>();
  for (const entry of entries) {
    severityCounts.set(entry.severity, (severityCounts.get(entry.severity) ?? 0) + 1);
    typeCounts.set(entry.curseType, (typeCounts.get(entry.curseType) ?? 0) + 1);
    if (entry.anchor !== null) markedLines.add(entry.lineNumber);
  }

  // The known severities come first, from FATAL to HEX. A value outside the schema list (the database forbids it) is
  // appended in alphabetical order, so the counts always add up to the total.
  const known = SEVERITY_ORDER.filter((severity) => severityCounts.has(severity));
  const unknown = [...severityCounts.keys()].filter((severity) => !(SEVERITY_ORDER as readonly string[]).includes(severity)).sort(compareText);
  const bySeverity = [...known, ...unknown].map((severity) => ({ severity, count: severityCounts.get(severity) ?? 0 }));

  const byType = [...typeCounts.entries()]
    .map(([curseType, count]) => ({ curseType, label: curseLabel(curseType), count }))
    .sort((a, b) => compareText(a.label, b.label) || compareText(a.curseType, b.curseType));

  return { total: entries.length, bySeverity, byType, entries, markedLines };
}
