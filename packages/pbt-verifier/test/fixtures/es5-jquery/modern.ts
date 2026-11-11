export function normalizeTags(text: string): string[] {
  const tags = text
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((tag) => tag.length > 0);
  return [...new Set(tags)];
}
