/** Parses a "page" query value. Anything that is not a positive integer becomes page 1. */
export function parsePage(value: string | undefined): number {
  if (value === undefined || !/^[1-9]\d{0,5}$/.test(value)) return 1;
  return Number(value);
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}