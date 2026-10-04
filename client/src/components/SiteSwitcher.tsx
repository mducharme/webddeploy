import { Link, useSearch } from '@tanstack/react-router';
import { ChevronsUpDown, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSiteNames } from '../lib/api.ts';
import { cx } from './ui.tsx';

/** Jump to another site from a site page, staying on the same tab. Uses the instant names list. */
export function SiteSwitcher({ server, current }: { server: string; current: string }) {
  const names = useSiteNames(server);
  const search = useSearch({ strict: false }) as { tab?: string };
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const list = (names.data?.sites ?? []).filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setQ('');
        }}
        aria-expanded={open}
        aria-label="Switch to another site"
        title="Switch to another site"
        className="rounded-md p-1 text-stone-400 hover:bg-stone-200/60 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
      >
        <ChevronsUpDown className="size-5" aria-hidden />
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-72 overflow-hidden rounded-md border border-stone-200 bg-white text-sm font-normal shadow-lg dark:border-stone-700 dark:bg-stone-900" data-testid="site-switcher">
          <div className="relative border-b border-stone-200 dark:border-stone-700">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-stone-400" aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a site"
              aria-label="Find a site"
              className="w-full bg-transparent py-2 pr-2 pl-8 focus:outline-none"
              onKeyDown={(e) => {
                // Enter opens the first match.
                if (e.key === 'Enter' && list[0]) (ref.current?.querySelector('a[data-first]') as HTMLAnchorElement | null)?.click();
              }}
            />
          </div>
          <ul className="max-h-80 overflow-auto py-1">
            {names.isPending && <li className="px-3 py-2 text-stone-500">Loading…</li>}
            {list.map((s, i) => (
              <li key={s.name}>
                <Link
                  to="/s/$server/sites/$name"
                  params={{ server, name: s.name }}
                  search={{ tab: (search.tab ?? 'overview') as never }}
                  onClick={() => setOpen(false)}
                  data-first={i === 0 ? '' : undefined}
                  className={cx('flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-stone-100 dark:hover:bg-stone-800', s.name === current && 'font-semibold text-teal-700 dark:text-teal-400', s.preview && 'pl-6')}
                >
                  <span className="truncate">{s.name}</span>
                  {s.preview && <span className="shrink-0 text-xs text-stone-400">preview</span>}
                </Link>
              </li>
            ))}
            {names.data && list.length === 0 && <li className="px-3 py-2 text-stone-500">No site matches.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
