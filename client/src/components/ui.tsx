import type { CheckStatus, Hint, RunPhase } from '@webddeploy/shared';
import { Loader2 } from 'lucide-react';
import { explainError } from '../lib/errors.ts';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variants: Record<Variant, string> = {
  primary: 'bg-teal-700 text-white hover:bg-teal-800 disabled:bg-teal-700/50',
  secondary:
    'border border-stone-300 bg-white text-stone-800 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800',
  danger: 'bg-red-700 text-white hover:bg-red-800',
  ghost: 'text-stone-600 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-800',
};

export function Button({
  variant = 'secondary',
  busy,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed',
        variants[variant],
        className,
      )}
    >
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/** A button that asks once before acting: click, then "Confirm". */
export function ConfirmButton({
  onConfirm,
  label,
  confirmLabel,
  busyLabel,
  busy,
  disabled,
  icon,
}: {
  /** May return a promise: the button then stays busy until it settles (the row gone, the list reloaded). */
  onConfirm: () => void | Promise<unknown>;
  label: string;
  confirmLabel: string;
  /** Shown while busy, e.g. "Deleting…". */
  busyLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);
  const isBusy = busy || working;
  if (asking && !isBusy) {
    return (
      <span className="inline-flex items-center gap-1">
        <Button
          variant="primary"
          onClick={() => {
            setAsking(false);
            const p = onConfirm();
            if (p && typeof (p as Promise<unknown>).then === 'function') {
              setWorking(true);
              // Errors are shown by whoever owns the mutation; this only ends the busy state.
              (p as Promise<unknown>).catch(() => {}).finally(() => mounted.current && setWorking(false));
            }
          }}
        >
          {confirmLabel}
        </Button>
        <Button variant="ghost" onClick={() => setAsking(false)}>
          Cancel
        </Button>
      </span>
    );
  }
  return (
    <Button onClick={() => setAsking(true)} busy={isBusy} disabled={disabled || isBusy}>
      {!isBusy && icon}
      {isBusy && busyLabel ? busyLabel : label}
    </Button>
  );
}

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx('rounded-lg border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-4 py-2.5 dark:border-stone-800">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

const statusStyles: Record<CheckStatus | 'pending', string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  fail: 'bg-red-600',
  off: 'bg-stone-400',
  pending: 'bg-stone-300 animate-pulse dark:bg-stone-700',
};

export function StatusDot({ status, label }: { status: CheckStatus | 'pending'; label?: string }) {
  return (
    <span
      role="img"
      aria-label={label ?? status}
      title={label ?? status}
      className={cx('inline-block size-2.5 shrink-0 rounded-full', statusStyles[status])}
    />
  );
}

const badgeStyles: Record<string, string> = {
  ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  succeeded: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  warn: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
  skipped: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
  fail: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  unknown: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  off: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400',
  running: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  queued: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
};

export function Badge({ tone, children }: { tone: CheckStatus | RunPhase | 'neutral'; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium',
        badgeStyles[tone] ?? 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
      )}
    >
      {(tone === 'running' || tone === 'queued') && <Loader2 className="size-3 animate-spin" aria-hidden />}
      {children}
    </span>
  );
}

export function PhaseBadge({ phase }: { phase: RunPhase }) {
  const label: Record<RunPhase, string> = {
    queued: 'queued',
    running: 'running',
    succeeded: 'succeeded',
    failed: 'failed',
    skipped: 'up to date',
    unknown: 'no result',
  };
  return <Badge tone={phase}>{label[phase]}</Badge>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-4 text-sm text-stone-500" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorBox({ error, title = 'Something went wrong', hint: given }: { error: unknown; title?: string; hint?: Hint | null }) {
  const explained = explainError(error);
  const message = explained.message;
  const hint = explained.hint ?? given ?? null;
  return (
    <div role="alert" className="m-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
      <p className="font-medium">{title}</p>
      <p className="mt-1 break-words">{message}</p>
      {hint && (
        <p className="mt-2 border-t border-red-200 pt-2 text-red-800 dark:border-red-900 dark:text-red-300" data-testid="error-hint">
          <span className="font-medium">{hint.cause}</span> {hint.next}
        </p>
      )}
    </div>
  );
}

/** An error in a line of its own (under a button), with its hint when there is one. */
export function InlineError({ error, className }: { error: unknown; className?: string }) {
  const { message, hint } = explainError(error);
  return (
    <span role="alert" className={cx('block', className)}>
      {message}
      {hint && <span className="block text-stone-600 dark:text-stone-400" data-testid="error-hint">{hint.next}</span>}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="p-4 text-sm text-stone-500">{children}</p>;
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={cx('font-mono text-[0.8125rem]', className)}>{children}</code>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: string }>; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-stone-200 dark:border-stone-800">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={t.id === value}
          onClick={() => onChange(t.id)}
          className={cx(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
            t.id === value
              ? 'border-teal-700 text-teal-800 dark:border-teal-400 dark:text-teal-300'
              : 'border-transparent text-stone-500 hover:text-stone-800 dark:hover:text-stone-200',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {error ? <span className="mt-1 block text-xs text-red-700 dark:text-red-400">{error}</span> : hint ? <span className="mt-1 block text-xs text-stone-500">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  'w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm shadow-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 dark:border-stone-700 dark:bg-stone-950';

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx('px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-stone-500', className)}>{children}</th>;
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx('px-3 py-2 align-top text-sm', className)}>{children}</td>;
}
