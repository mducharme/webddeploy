import { Link } from '@tanstack/react-router';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';
import { cx } from './ui.tsx';

export type ToastTone = 'success' | 'error' | 'info';
export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  detail?: string;
  /** An in-app link, e.g. to the run that finished. */
  link?: { label: string; to: string; params?: Record<string, string> };
}

// A tiny store, so anything can toast (mutation callbacks, the live stream), not just components.
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(t: Omit<Toast, 'id'>): number {
  const id = nextId++;
  toasts = [...toasts.slice(-4), { ...t, id }];
  emit();
  return id;
}
toast.success = (message: string, more: Partial<Omit<Toast, 'id' | 'tone' | 'message'>> = {}) => toast({ tone: 'success', message, ...more });
toast.error = (message: string, more: Partial<Omit<Toast, 'id' | 'tone' | 'message'>> = {}) => toast({ tone: 'error', message, ...more });
toast.info = (message: string, more: Partial<Omit<Toast, 'id' | 'tone' | 'message'>> = {}) => toast({ tone: 'info', message, ...more });

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** For tests. */
export function clearToasts() {
  toasts = [];
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

function ToastItem({ t }: { t: Toast }) {
  useEffect(() => {
    const timer = setTimeout(() => dismiss(t.id), t.tone === 'error' ? 12_000 : 5_000);
    return () => clearTimeout(timer);
  }, [t.id, t.tone]);
  const Icon = t.tone === 'success' ? CircleCheck : t.tone === 'error' ? CircleAlert : Info;
  return (
    <div
      role={t.tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'pointer-events-auto flex w-80 max-w-[calc(100vw-2rem)] items-start gap-2 rounded-lg border bg-white p-3 text-sm shadow-lg dark:bg-stone-900',
        t.tone === 'error' ? 'border-red-300 dark:border-red-900' : 'border-stone-200 dark:border-stone-700',
      )}
    >
      <Icon className={cx('mt-0.5 size-4 shrink-0', t.tone === 'success' ? 'text-emerald-600' : t.tone === 'error' ? 'text-red-600' : 'text-sky-600')} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium break-words">{t.message}</p>
        {t.detail && <p className="mt-0.5 text-xs break-words text-stone-500 dark:text-stone-400">{t.detail}</p>}
        {t.link && (
          <Link to={t.link.to as never} params={t.link.params as never} onClick={() => dismiss(t.id)} className="mt-1 inline-block text-xs text-teal-700 hover:underline dark:text-teal-400">
            {t.link.label}
          </Link>
        )}
      </div>
      <button type="button" onClick={() => dismiss(t.id)} className="text-stone-400 hover:text-stone-600" aria-label="Dismiss">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => toasts);
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2">
      {list.map((t) => <ToastItem key={t.id} t={t} />)}
    </div>
  );
}
