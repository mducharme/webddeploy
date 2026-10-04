import { cx } from './ui.tsx';

export interface Change {
  label: string;
  kind: 'added' | 'changed' | 'removed';
  from?: string | null;
  to?: string | null;
  /** Shown as dots: a password doesn't belong on screen just because it changed. */
  secret?: boolean;
}

const show = (v: string | null | undefined, secret?: boolean) => {
  if (v === null || v === undefined) return '—';
  if (secret) return v === '' ? '(empty)' : '••••••';
  if (v === '') return '(empty)';
  return v.length > 60 ? `${v.slice(0, 57)}…` : v;
};

/** What a save is about to change, and when it takes effect — shown above the Save button. */
export function ChangeSummary({ changes, note }: { changes: readonly Change[]; note?: string }) {
  if (changes.length === 0) return null;
  return (
    <div className="rounded-md border border-teal-200 bg-teal-50/60 p-3 text-sm dark:border-teal-900 dark:bg-teal-950/30" data-testid="change-summary">
      <p className="mb-1 font-medium">
        {changes.length} change{changes.length > 1 ? 's' : ''} to save{note ? <span className="font-normal text-stone-600 dark:text-stone-400"> — {note}</span> : null}
      </p>
      <ul className="space-y-0.5 font-mono text-xs">
        {changes.map((c) => (
          <li key={c.label} className="break-all">
            <span className={cx('mr-1 inline-block w-3 font-bold', c.kind === 'added' ? 'text-emerald-700' : c.kind === 'removed' ? 'text-red-700' : 'text-amber-700')}>
              {c.kind === 'added' ? '+' : c.kind === 'removed' ? '−' : '~'}
            </span>
            <span className="font-semibold">{c.label}</span>
            {c.kind === 'added' && <>: {show(c.to, c.secret)}</>}
            {c.kind === 'changed' && <>: <span className="text-stone-500">{show(c.from, c.secret)}</span> → {show(c.to, c.secret)}</>}
            {c.kind === 'removed' && <span className="text-stone-500"> (removed)</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
