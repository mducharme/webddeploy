import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import type { LogInfo } from '@webddeploy/shared';
import { Card, ErrorBox, Spinner, cx } from '../components/ui.tsx';
import { useLogs } from '../lib/api.ts';
import { bytes, relativeTime } from '../lib/format.ts';
import { SiteLog } from './Site.tsx';

const groups: Array<{ kind: LogInfo['kind']; label: string }> = [
  { kind: 'webhook', label: 'Git push webhook' },
  { kind: 'fleet', label: 'Scheduled jobs' },
  { kind: 'site', label: 'Sites' },
];

export function Logs() {
  const { server } = useParams({ from: '/s/$server/logs' });
  const { name } = useSearch({ from: '/s/$server/logs' });
  const navigate = useNavigate({ from: '/s/$server/logs' });
  const logs = useLogs(server);

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <Card title="Logs">
        {logs.isPending ? (
          <Spinner />
        ) : logs.error ? (
          <ErrorBox error={logs.error} />
        ) : (
          <nav className="max-h-[70vh] overflow-y-auto py-1">
            {groups.map((g) => {
              const items = logs.data.logs.filter((l) => l.kind === g.kind);
              if (!items.length) return null;
              return (
                <div key={g.kind} className="py-1">
                  <p className="px-4 py-1 text-xs font-medium uppercase tracking-wide text-stone-500">{g.label}</p>
                  {items.map((l) => (
                    <button
                      key={l.name}
                      type="button"
                      onClick={() => void navigate({ search: { name: l.name } })}
                      className={cx(
                        'flex w-full items-baseline justify-between gap-2 px-4 py-1.5 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-800',
                        l.name === name && 'bg-teal-50 font-medium text-teal-900 dark:bg-teal-950 dark:text-teal-200',
                      )}
                    >
                      <span className="truncate">{l.name}</span>
                      <span className="shrink-0 text-xs text-stone-400" title={`${bytes(l.size)}, modified ${l.modified_at}`}>{relativeTime(l.modified_at)}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </nav>
        )}
      </Card>
      {name ? <SiteLog key={name} server={server} name={name} /> : <Card className="p-6 text-sm text-stone-500">Pick a log to follow it live.</Card>}
    </div>
  );
}
