import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { relativeTime } from '../lib/format.ts';
import { Button, cx } from './ui.tsx';

/** "Updated 12s ago" (kept current) and a button that reloads from ddeploy, bypassing the server's cache. */
export function RefreshBar({ updatedAt, refreshing, onRefresh, className }: { updatedAt: number; refreshing: boolean; onRefresh: () => void; className?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5_000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className={cx('inline-flex items-center gap-2 text-xs text-stone-500', className)}>
      <span title={updatedAt ? new Date(updatedAt).toLocaleString() : undefined} data-testid="updated-at">
        {refreshing ? 'Refreshing…' : updatedAt ? `Updated ${relativeTime(new Date(updatedAt).toISOString())}` : 'Not loaded yet'}
      </span>
      <Button variant="ghost" busy={refreshing} disabled={refreshing} onClick={onRefresh} title="Reload now, straight from the server">
        <RefreshCw className="size-4" aria-hidden /> Refresh
      </Button>
    </span>
  );
}
