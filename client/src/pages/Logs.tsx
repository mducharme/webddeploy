import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import type { LogInfo } from '@webddeploy/shared';
import { FileText, Globe, Server } from 'lucide-react';
import { Button, Card, ErrorBox, Spinner, cx } from '../components/ui.tsx';
import { useLogs } from '../lib/api.ts';
import { bytes, relativeTime } from '../lib/format.ts';
import { LogStream } from './Site.tsx';

/** Server-wide nginx and PHP-FPM logs first, as quick buttons; then everything, grouped. */
export function Logs() {
  const { server } = useParams({ from: '/s/$server/logs' });
  const { name } = useSearch({ from: '/s/$server/logs' });
  const navigate = useNavigate({ from: '/s/$server/logs' });
  const logs = useLogs(server);
  const open = (n: string) => void navigate({ search: { name: n } });
  const all = logs.data?.logs ?? [];
  const serverLogs = all.filter((l) => l.kind === 'server');
  const selected = all.find((l) => l.name === name);

  const sites = [...new Set(all.filter((l) => l.kind === 'site' || l.kind === 'nginx').map((l) => l.site ?? l.name))].sort();
  const groups: Array<{ label: string; items: LogInfo[] }> = [
    { label: 'Git push webhook', items: all.filter((l) => l.kind === 'webhook') },
    { label: 'Scheduled jobs', items: all.filter((l) => l.kind === 'fleet') },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 flex items-center gap-1.5 text-sm font-medium text-stone-600 dark:text-stone-300">
            <Server className="size-4" aria-hidden /> Web server
          </span>
          {logs.isPending && <span className="text-sm text-stone-500">…</span>}
          {serverLogs.map((l) => (
            <Button key={l.name} variant={l.name === name ? 'primary' : 'secondary'} onClick={() => open(l.name)}>
              {l.label ?? l.name}
            </Button>
          ))}
          {logs.data && serverLogs.length === 0 && <span className="text-sm text-stone-500">Not available — update ddeploy on the server.</span>}
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-[17rem_1fr]">
        <Card title="Logs">
          {logs.isPending ? (
            <Spinner />
          ) : logs.error ? (
            <ErrorBox error={logs.error} />
          ) : (
            <nav className="max-h-[70vh] overflow-y-auto py-1">
              {groups.map((g) =>
                g.items.length ? (
                  <div key={g.label} className="py-1">
                    <p className="px-4 py-1 text-xs font-medium uppercase tracking-wide text-stone-500">{g.label}</p>
                    {g.items.map((l) => <LogLink key={l.name} log={l} active={l.name === name} onClick={() => open(l.name)} label={l.name} />)}
                  </div>
                ) : null,
              )}
              <div className="py-1">
                <p className="px-4 py-1 text-xs font-medium uppercase tracking-wide text-stone-500">Sites</p>
                {sites.map((site) => (
                  <div key={site} className="pb-1">
                    <p className="px-4 pt-1.5 text-sm font-medium">{site}</p>
                    {all
                      .filter((l) => (l.site ?? (l.kind === 'site' ? l.name : null)) === site)
                      .map((l) => (
                        <LogLink key={l.name} log={l} active={l.name === name} onClick={() => open(l.name)} label={shortLabel(l)} indent />
                      ))}
                  </div>
                ))}
              </div>
            </nav>
          )}
        </Card>
        {name ? (
          <LogStream key={name} server={server} name={name} title={selected?.label ? `${selected.site ? `${selected.site} — ` : ''}${selected.label}` : name} />
        ) : (
          <Card className="p-6 text-sm text-stone-500">Pick a log to follow it live.</Card>
        )}
      </div>
    </div>
  );
}

function shortLabel(l: LogInfo): string {
  if (l.name.endsWith('.error')) return 'Errors (nginx + PHP)';
  if (l.name.endsWith('.access')) return 'Access';
  return 'Deploys & previews';
}

function LogLink({ log, active, onClick, label, indent }: { log: LogInfo; active: boolean; onClick: () => void; label: string; indent?: boolean }) {
  const Icon = log.kind === 'nginx' ? Globe : FileText;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'flex w-full items-baseline justify-between gap-2 py-1.5 pr-4 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-800',
        indent ? 'pl-6' : 'pl-4',
        active && 'bg-teal-50 font-medium text-teal-900 dark:bg-teal-950 dark:text-teal-200',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5 truncate">
        <Icon className="size-3.5 shrink-0 text-stone-400" aria-hidden />
        {label}
      </span>
      <span className="shrink-0 text-xs text-stone-400" title={`${bytes(log.size)}, modified ${log.modified_at}`}>{relativeTime(log.modified_at)}</span>
    </button>
  );
}
