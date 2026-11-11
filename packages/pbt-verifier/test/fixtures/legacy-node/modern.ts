type QueryValue = string | number | boolean;

export function buildQuery(params: Record<string, QueryValue>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
    .join('&');
}
