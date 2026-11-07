export type QueryValue = string | string[];
export type QueryResult = Record<string, QueryValue>;

function decodeComponent(raw: string): string {
  return decodeURIComponent(raw.replace(/\+/g, ' '));
}

export function parseQueryString(query: string): QueryResult {
  const result: QueryResult = {};
  const text = query.startsWith('?') ? query.substring(1) : query;
  if (text === '') return result;

  for (const pair of text.split('&')) {
    if (pair === '') continue;

    const separator = pair.indexOf('=');
    const rawKey = separator < 0 ? pair : pair.substring(0, separator);
    const rawValue = separator < 0 ? '' : pair.substring(separator + 1);
    const key = decodeComponent(rawKey);
    const value = decodeComponent(rawValue);

    // Assigning a string to "__proto__" is a silent no-op on a plain object. The key is skipped
    // explicitly so that the result never depends on prototype setters.
    if (key === '__proto__') continue;

    const existing = Object.hasOwn(result, key) ? result[key] : undefined;
    if (existing === undefined) {
      result[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      result[key] = [existing, value];
    }
  }

  return result;
}
