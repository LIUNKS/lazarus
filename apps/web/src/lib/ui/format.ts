/** Formats an ISO timestamp as YYYY-MM-DD in UTC, or an em dash when it is not a valid date. */
export function formatDateUtc(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '—';
  return new Date(time).toISOString().slice(0, 10);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}