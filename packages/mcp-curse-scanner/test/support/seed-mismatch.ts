import type { CurseFinding, FunctionSignature } from '../../src/lib.ts';
import type { SeededCurse } from './seed-loader.ts';

/** Message for a Seeded_Curse that has no finding on its Seeded_Line (Requirement 17.9). */
export function describeMismatch(folder: string, curse: SeededCurse, findings: readonly CurseFinding[]): string {
  const lines = findings.filter((finding) => finding.curseType === curse.type).map((finding) => finding.lineNumber);
  const returned = lines.length === 0 ? 'none' : `${curse.type} at lines [${lines.join(', ')}]`;
  return (
    `Sample_Source "${folder}": ${curse.type} expected at Seeded_Line ${curse.seededLine} (match "${curse.match}") ` +
    `but the scanner returned ${returned}`
  );
}

/** Message for an Entry_Function that is not found exactly once (Requirement 17.9). */
export function describeEntryMismatch(
  folder: string,
  entryFunction: string,
  signatures: readonly FunctionSignature[],
): string {
  const found = signatures.filter((signature) => signature.name === entryFunction).length;
  return `Sample_Source "${folder}": Entry_Function "${entryFunction}" expected exactly once but the scanner returned ${found} signatures with that name`;
}
