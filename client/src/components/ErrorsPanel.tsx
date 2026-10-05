import { useState } from 'react';
import { useErrors, useSiteRuns } from '../lib/api.ts';
import { relativeTime } from '../lib/format.ts';
import { SeeLink } from './Checks.tsx';
import { Button, Card, Empty, ErrorBox, Spinner, cx } from './ui.tsx';

/** The site's errors grouped by message: the one fatal behind 4,000 log lines is one row with its count. */
export function ErrorsPanel({ server, name }: { server: string; name: string }) {
  const runs = useSiteRuns(server, name);
  const lastDeploy = runs.data?.runs.find((r) => ['deploy', 'rollback', 'provision'].includes(r.kind) && r.phase === 'succeeded')?.finished_at ?? null;
  const [range, setRange] = useState<'deploy' | 'day'>('deploy');
  const since = range === 'deploy' ? lastDeploy : null;
  const errors = useErrors(server, name, since);
  const toggle = (
    <span className="flex gap-1" role="group" aria-label="Errors since">
      {lastDeploy && (
        <Button variant={range === 'deploy' ? 'primary' : 'ghost'} onClick={() => setRange('deploy')}>
          Since last deploy
        </Button>
      )}
      <Button variant={range === 'day' || !lastDeploy ? 'primary' : 'ghost'} onClick={() => setRange('day')}>
        Last 24 hours
      </Button>
    </span>
  );
  return (
    <Card title="Top errors" actions={toggle}>
      {errors.isPending ? (
        <Spinner label="Reading the error log…" />
      ) : errors.error ? (
        <ErrorBox error={errors.error} title="Couldn't read the errors" />
      ) : errors.data.groups.length === 0 ? (
        <Empty>
          No errors logged {since ? `since the last deploy (${relativeTime(since)})` : 'in the last 24 hours'}.
        </Empty>
      ) : (
        <>
          <p className="px-4 pt-3 text-xs text-stone-500">
            {errors.data.total} line{errors.data.total === 1 ? '' : 's'} logged since {relativeTime(errors.data.since)}, grouped by message — most frequent first.
          </p>
          <ul className="divide-y divide-stone-100 dark:divide-stone-800" data-testid="errors-panel">
            {errors.data.groups.map((g) => (
              <li key={g.message} className="flex items-start gap-3 px-4 py-2 text-sm">
                <span
                  className={cx(
                    'mt-0.5 shrink-0 rounded px-1.5 font-mono text-xs tabular-nums',
                    g.severity === 'error' ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
                  )}
                >
                  ×{g.count}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-mono text-xs text-stone-800 dark:text-stone-200">{g.message}</span>
                  <span className="text-xs text-stone-500">
                    last {relativeTime(g.last_seen)}
                    {g.count > 1 && `, first ${relativeTime(g.first_seen)}`}
                    {g.request && <> · {g.request}</>}
                  </span>
                </span>
                <SeeLink see={{ type: 'log', log: errors.data.log, find: g.message.slice(0, 60) }} server={server} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
