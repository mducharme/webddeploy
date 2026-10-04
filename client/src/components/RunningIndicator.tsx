import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { kindLabel, relativeTime } from '../lib/format.ts';
import { useRunning } from '../lib/live.ts';

/** "● 2 running" in the top bar while anything runs; the list on click. */
export function RunningIndicator({ server }: { server: string }) {
  const running = useRunning(server);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  if (running.length === 0) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid="running-indicator"
        className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-900 hover:bg-sky-200 dark:bg-sky-950 dark:text-sky-200"
      >
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-500 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-sky-600" />
        </span>
        {running.length} running
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-72 overflow-hidden rounded-md border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-900">
          {running.map((r) => (
            <Link
              key={r.run_id}
              to="/s/$server/runs/$id"
              params={{ server, id: r.run_id }}
              onClick={() => setOpen(false)}
              role="menuitem"
              className="block px-3 py-2 text-sm hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              <span className="font-medium">{kindLabel(r.kind)}</span> {r.site}
              <span className="block text-xs text-stone-500">started {relativeTime(r.started_at)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
