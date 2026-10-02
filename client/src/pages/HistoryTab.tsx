import { CHANGE_KINDS, type Run, type SiteDetailResponse } from '@webddeploy/shared';
import { useMemo, useState } from 'react';
import { RunTable } from '../components/RunTable.tsx';
import { Card, ErrorBox, Spinner, cx } from '../components/ui.tsx';
import { useSiteRuns } from '../lib/api.ts';
import { RollbackButton } from './siteShared.tsx';

export const HISTORY_FILTERS = {
  all: { label: 'All', match: () => true },
  failed: { label: 'Failed', match: (r: Run) => r.phase === 'failed' || r.phase === 'unknown' },
  deploys: { label: 'Deploys', match: (r: Run) => ['deploy', 'rollback', 'provision'].includes(r.kind) },
  database: { label: 'Database', match: (r: Run) => r.kind.startsWith('db-') },
  changes: { label: 'Config changes', match: (r: Run) => CHANGE_KINDS.has(r.kind) },
} as const satisfies Record<string, { label: string; match: (r: Run) => boolean }>;
export type HistoryFilter = keyof typeof HISTORY_FILTERS;

export function HistoryTab({ server, detail }: { server: string; detail: SiteDetailResponse }) {
  const runs = useSiteRuns(server, detail.site.name);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const counts = useMemo(() => {
    const all = runs.data?.runs ?? [];
    return Object.fromEntries(Object.entries(HISTORY_FILTERS).map(([k, f]) => [k, all.filter(f.match).length])) as Record<HistoryFilter, number>;
  }, [runs.data]);
  const shown = (runs.data?.runs ?? []).filter(HISTORY_FILTERS[filter].match);
  const live = detail.site.sha;

  return (
    <Card
      title="History"
      actions={
        <div role="group" aria-label="Filter history" className="flex flex-wrap gap-1">
          {(Object.keys(HISTORY_FILTERS) as HistoryFilter[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
              className={cx(
                'rounded-full px-2.5 py-1 text-xs font-medium',
                filter === k ? 'bg-teal-700 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300',
              )}
            >
              {HISTORY_FILTERS[k].label} <span className="opacity-70">{counts[k]}</span>
            </button>
          ))}
        </div>
      }
    >
      {runs.isPending ? (
        <Spinner />
      ) : runs.error ? (
        <ErrorBox error={runs.error} />
      ) : (
        <RunTable
          runs={shown}
          server={server}
          repo={detail.site.repo}
          empty={filter === 'failed' ? 'No failures recorded.' : 'Nothing recorded yet.'}
          actions={
            detail.site.preview
              ? undefined
              : (r) =>
                  r.phase === 'succeeded' && ['deploy', 'rollback', 'provision'].includes(r.kind) && r.to_sha && r.to_sha !== live ? (
                    <RollbackButton server={server} name={detail.site.name} sha={r.to_sha} />
                  ) : r.to_sha && r.to_sha === live && ['deploy', 'rollback', 'provision'].includes(r.kind) && r.phase === 'succeeded' ? (
                    <span className="text-xs text-emerald-700 dark:text-emerald-400">live</span>
                  ) : null
          }
        />
      )}
    </Card>
  );
}
