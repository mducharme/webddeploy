import type { Change } from '../components/ChangeSummary.tsx';
import { patterns, type EnvChangeRequest } from '@webddeploy/shared';
import type { MaskedEnvEntry } from './api.ts';

/** One row of the editor: a server entry and/or a local edit. */
export interface EnvRow {
  key: string;
  /** What's on the server ('' for a masked value not revealed yet). */
  original: string | null;
  masked: boolean;
  managed: boolean;
  length: number;
  /** The edited value; null = untouched. */
  draft: string | null;
  deleted: boolean;
  isNew: boolean;
}

export function rowsFrom(entries: readonly MaskedEnvEntry[]): EnvRow[] {
  return entries.map((e) => ({
    key: e.key,
    original: e.value,
    masked: e.masked,
    managed: e.managed,
    length: e.length,
    draft: null,
    deleted: false,
    isNew: false,
  }));
}

/** What to send: changed or new keys with their value, deleted keys to unset. */
export function diff(rows: readonly EnvRow[]): EnvChangeRequest & { set: Record<string, string>; unset: string[] } {
  const set: Record<string, string> = {};
  const unset: string[] = [];
  for (const r of rows) {
    if (r.deleted) {
      if (!r.isNew) unset.push(r.key);
      continue;
    }
    if (r.isNew || (r.draft !== null && r.draft !== r.original)) set[r.key] = r.draft ?? '';
  }
  return { set, unset };
}

export function rowError(row: EnvRow, rows: readonly EnvRow[]): string | null {
  if (row.deleted) return null;
  if (!patterns.envKey.test(row.key)) return 'letters, digits and _ only, not starting with a digit';
  if (rows.filter((r) => !r.deleted && r.key === row.key).length > 1) return 'duplicate key';
  if (row.draft !== null && /[\r\n]/.test(row.draft)) return 'no line breaks';
  return null;
}

/** Parses pasted KEY=value lines (a .env file) into new rows; comments and blanks skipped. */
export function parsePasted(text: string): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (m) out.push({ key: m[1]!, value: m[2]! });
  }
  return out;
}

/** Applies pasted pairs: existing keys get a draft value, others become new rows. */
export function applyPasted(rows: readonly EnvRow[], pairs: ReadonlyArray<{ key: string; value: string }>): EnvRow[] {
  const next = rows.map((r) => ({ ...r }));
  for (const { key, value } of pairs) {
    const existing = next.find((r) => r.key === key && !r.deleted);
    if (existing) existing.draft = value;
    else next.push({ key, original: null, masked: false, managed: false, length: 0, draft: value, deleted: false, isNew: true });
  }
  return next;
}

/** The rows' changes as a list to review before saving (secret-looking values stay masked). */
export function envChanges(rows: readonly EnvRow[], isSecret: (key: string) => boolean): Change[] {
  const out: Change[] = [];
  for (const r of rows) {
    const secret = r.masked || isSecret(r.key);
    if (r.deleted) {
      if (!r.isNew) out.push({ label: r.key, kind: 'removed', secret });
    } else if (r.isNew) {
      if (r.key) out.push({ label: r.key, kind: 'added', to: r.draft ?? '', secret });
    } else if (r.draft !== null && r.draft !== r.original) {
      out.push({ label: r.key, kind: 'changed', from: r.original, to: r.draft, secret });
    }
  }
  return out;
}
