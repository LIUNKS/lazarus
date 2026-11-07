export interface Position {
  line: number;
  column: number;
}

export interface LineIndex {
  readonly lineCount: number;
  position(offset: number): Position;
}

// Line terminators: LF, CR, CR LF (one), U+2028, and U+2029 (the ones acorn uses).
export function createLineIndex(source: string): LineIndex {
  const starts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i);
    if (c === 13 && source.charCodeAt(i + 1) === 10) i++;
    else if (c !== 10 && c !== 13 && c !== 0x2028 && c !== 0x2029) continue;
    starts.push(i + 1);
  }
  const lineStarts = Uint32Array.from(starts);

  return {
    lineCount: lineStarts.length,
    position(offset: number): Position {
      let low = 0;
      let high = lineStarts.length - 1;
      while (low < high) {
        const mid = (low + high + 1) >>> 1;
        if (lineStarts[mid]! <= offset) low = mid;
        else high = mid - 1;
      }
      // Column is a 1-based count of UTF-16 code units from the line start.
      return { line: low + 1, column: offset - lineStarts[low]! + 1 };
    },
  };
}
