// Line_Count as the Curse_Scanner defines it, for the precomputed scan response that must not scan again.
// The scanner library does not export its counter, so a parity test pins this function to `scanCurses(...).lineCount`.
// Line terminators: LF, CR, CR LF (one terminator), U+2028, and U+2029. A text without a terminator has 1 line.
export function countLines(text: string): number {
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 13 && text.charCodeAt(i + 1) === 10) {
      i++;
      lines++;
    } else if (code === 10 || code === 13 || code === 0x2028 || code === 0x2029) {
      lines++;
    }
  }
  return lines;
}
