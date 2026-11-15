// Cache candidate selection by `code_hash` (Requirement 7). Pure module.
// Only rows that Row Level Security lets the caller read take part: samples and the member's own corpses.
// Results are never shared between two users, because a generated spec describes the private code it came from.
import type { HashMatch, ReincarnationRow, SeanceRow } from './types';

/** An empty hash never matches anything. */
export function hashIsMatchable(codeHash: string): boolean {
  return codeHash !== '';
}

/** Keeps the sample corpses and the corpses owned by the member. */
export function visibleMatches(matches: readonly HashMatch[], memberId: string): HashMatch[] {
  return matches.filter((match) => match.isSample || match.userId === memberId);
}

function jsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => jsonEqual(item, b[index]));
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]));
}

/** Same requirements, same design, and deeply equal invariants. jsonb has no key order, so objects compare by key. */
export function sameSeanceContent(a: Pick<SeanceRow, 'requirementsMd' | 'designMd' | 'invariantsJson'>, b: Pick<SeanceRow, 'requirementsMd' | 'designMd' | 'invariantsJson'>): boolean {
  return a.requirementsMd === b.requirementsMd && a.designMd === b.designMd && jsonEqual(a.invariantsJson, b.invariantsJson);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Descending by instant. The instants come from one database, so equal instants compare equal as text too. */
function compareNewestFirst(aTime: string, bTime: string, aId: string, bId: string): number {
  const a = Date.parse(aTime);
  const b = Date.parse(bTime);
  const byTime = Number.isNaN(a) || Number.isNaN(b) || a === b ? compareText(bTime, aTime) : b - a;
  return byTime !== 0 ? byTime : compareText(bId, aId);
}

/** Newest parent corpse first, then the larger corpse id. */
export function rankMatches(matches: readonly HashMatch[]): HashMatch[] {
  return [...matches].sort((a, b) => compareNewestFirst(a.createdAt, b.createdAt, a.corpseId, b.corpseId));
}

/** `seance_specs` has no timestamp, so recency is the recency of the parent corpse. */
export function pickSeance(rows: readonly SeanceRow[], matches: readonly HashMatch[]): SeanceRow | null {
  for (const match of rankMatches(matches)) {
    const row = rows.find((candidate) => candidate.corpseId === match.corpseId);
    if (row !== undefined) return row;
  }
  return null;
}

/** The newest reincarnation (ties: the larger id) among the corpses that are ranked matches and eligible. */
export function pickReincarnation(rows: readonly ReincarnationRow[], matches: readonly HashMatch[], eligibleCorpseIds: ReadonlySet<string>): ReincarnationRow | null {
  const matched = new Set(matches.map((match) => match.corpseId));
  const candidates = rows.filter((row) => matched.has(row.corpseId) && eligibleCorpseIds.has(row.corpseId));
  candidates.sort((a, b) => compareNewestFirst(a.createdAt, b.createdAt, a.id, b.id));
  return candidates[0] ?? null;
}
