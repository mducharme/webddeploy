import { Link } from '@tanstack/react-router';
import { parseTrigger, type Actor } from '@webddeploy/shared';
import { useMemo, useState } from 'react';
import { RunTable } from '../components/RunTable.tsx';
import { Badge, Card, Empty, ErrorBox, Mono, Spinner, Tabs, Td, Th, inputClass } from '../components/ui.tsx';
import { useActivity, useMe, useRecentRuns } from '../lib/api.ts';
import { useCan } from '../lib/role.tsx';
import { relativeTime } from '../lib/format.ts';

const ACTION_LABELS: Record<string, string> = {
  deploy: 'deployed',
  provision: 'provisioned',
  rollback: 'rolled back',
  'run.cancel': 'cancelled run',
  'env.change': 'changed the environment of',
  'env.reveal': 'revealed a secret of',
  'settings.change': 'changed settings of',
  'db.credentials': 'viewed database credentials of',
  'db.download': 'downloaded the database of',
  'db.import': 'imported a database into',
  'db.restore': 'restored a snapshot of',
  'db.snapshot': 'snapshotted the database of',
  'uploads.import': 'uploaded files to',
  'uploads.restore': 'restored files of',
  'uploads.snapshot': 'snapshotted the files of',
  'uploads.download': 'downloaded files of',
  'preview.create': 'created a preview of',
  'preview.deploy': 'redeployed a preview of',
  'preview.remove': 'removed a preview of',
  'backup.database': 'backed up the database of',
  'backup.uploads': 'backed up the files of',
  'backup.restore-db': 'restored the database of',
  'backup.restore-uploads': 'restored files of',
  'backup.keep': 'kept a backup of',
  'backup.unkeep': 'stopped keeping a backup of',
  'backup.delete': 'deleted a backup of',
  'backup.download': 'downloaded a backup of',
  'uploads.fetch': 'copied files from another server into',
  'fetch.accept-host': 'confirmed the host key of a server, for',
  'fetch.forget-host': 'forgot a host key',
  'config.set': 'changed server settings',
  'user.set': 'set the role of',
  'user.remove': 'removed the access of',
  'options.set': 'changed global options',
};

/** A short summary of an audit entry's detail (never values: the server only records key names). */
function describe(action: string, detail: unknown): string {
  if (!detail || typeof detail !== 'object') return '';
  const d = detail as Record<string, unknown>;
  const parts: string[] = [];
  if (Array.isArray(d.set) && d.set.length) parts.push(`set ${d.set.join(', ')}`);
  else if (d.set && typeof d.set === 'object' && Object.keys(d.set).length) parts.push(`set ${Object.keys(d.set).join(', ')}`);
  if (Array.isArray(d.unset) && d.unset.length) parts.push(`reset ${d.unset.join(', ')}`);
  if (typeof d.key === 'string') parts.push(d.key);
  if (action === 'settings.change' && 'branch' in d && d.branch !== undefined) parts.push(d.branch === null ? 'branch → default' : `branch → ${String(d.branch)}`);
  if (typeof d.snapshot === 'string') parts.push(d.snapshot);
  if (typeof d.filename === 'string') parts.push(d.filename);
  if (typeof d.file === 'string') parts.push(d.file);
  if (typeof d.version === 'string') parts.push(`version ${d.version}`);
  if (typeof d.dir === 'string') parts.push(`${d.dir}${typeof d.mode === 'string' ? ` (${d.mode})` : ''}`);
  if (typeof d.source === 'string') parts.push(d.source);
  if (typeof d.branch === 'string' && action.startsWith('preview.')) parts.push(d.branch);
  if (typeof d.sha === 'string') parts.push(d.sha.slice(0, 7));
  if (typeof d.role === 'string') parts.push(d.role);
  if (typeof d.host === 'string') parts.push(`${d.host}${typeof d.port === 'number' && d.port !== 22 ? `:${d.port}` : ''}`);
  if (typeof d.fingerprint === 'string') parts.push(d.fingerprint);
  if (action === 'config.set') parts.push(Object.entries(d).map(([k, v]) => `${k}=${String(v)}`).join(', '));
  return parts.join(' · ');
}

const TABS = [
  { id: 'all', label: 'Everything' },
  { id: 'web', label: 'Web actions (audit log)' },
] as const;
type ActivityTab = (typeof TABS)[number]['id'];

/** The form input style, at its natural width (inputClass is full width). */
const filterClass = `${inputClass.replace(/\bw-full\b/, '')} w-44 py-1`;

const SOURCES: Record<Actor['type'], string> = { web: 'Web UI', webhook: 'Git push', schedule: 'Schedule (cron)', manual: 'CLI', unknown: 'Other' };

export function ActivityPage() {
  const isAdmin = useCan('admin');
  const [tab, setTab] = useState<ActivityTab>('all');
  const tabs = TABS.filter((t) => t.id === 'all' || isAdmin);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Activity</h1>
        <p className="text-sm text-stone-500">
          {tab === 'all'
            ? 'Every run on the server, whatever started it: the web UI, a git push, a schedule (backups, preview cleanup) or the command line.'
            : 'What people did in the web UI, with who did it — including what never starts a run: settings and environment changes, revealed secrets, downloads, users.'}
        </p>
      </div>
      {tabs.length > 1 && <Tabs tabs={[...tabs]} value={tab} onChange={setTab} />}
      {tab === 'all' ? <AllRuns /> : <WebActions />}
    </div>
  );
}

function AllRuns() {
  const server = useMe().data?.servers[0]?.id ?? 'local';
  const runs = useRecentRuns(server, 300);
  const [site, setSite] = useState('');
  const [source, setSource] = useState<'' | Actor['type']>('');
  const [failedOnly, setFailedOnly] = useState(false);
  const all = runs.data?.runs ?? [];
  const sites = useMemo(() => [...new Set(all.map((r) => r.site))].sort(), [all]);
  const shown = all.filter(
    (r) => (!site || r.site === site) && (!source || parseTrigger(r.trigger, r.author).type === source) && (!failedOnly || r.phase === 'failed'),
  );
  return (
    <Card
      title={`Runs${runs.data ? ` (${shown.length}${shown.length !== all.length ? ` of ${all.length}` : ''})` : ''}`}
      actions={
        <span className="flex flex-wrap items-center gap-2">
          <select className={filterClass} value={site} onChange={(e) => setSite(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {sites.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className={filterClass} value={source} onChange={(e) => setSource(e.target.value as Actor['type'] | '')} aria-label="Started by">
            <option value="">Any source</option>
            {(Object.keys(SOURCES) as Actor['type'][]).filter((k) => k !== 'unknown').map((k) => <option key={k} value={k}>{SOURCES[k]}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm font-normal text-stone-600 dark:text-stone-300">
            <input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} /> Failed only
          </label>
        </span>
      }
    >
      {runs.isPending ? <Spinner /> : runs.error ? <ErrorBox error={runs.error} /> : <RunTable runs={shown} server={server} showSite empty="Nothing matches." />}
    </Card>
  );
}

function WebActions() {
  const activity = useActivity();
  return (
    <Card title="Web actions">
      {activity.isPending ? (
        <Spinner />
      ) : activity.error ? (
        <ErrorBox error={activity.error} />
      ) : activity.data.entries.length === 0 ? (
        <Empty>Nothing yet. Deploys and provisions started here are recorded with who started them.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem]">
            <thead className="border-b border-stone-200 dark:border-stone-800">
              <tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Result</Th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {activity.data.entries.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap" ><span title={e.at}>{relativeTime(e.at)}</span></Td>
                  <Td>{e.email}</Td>
                  <Td>
                    {ACTION_LABELS[e.action] ?? e.action} <Mono>{e.target}</Mono>
                    {describe(e.action, e.detail) && <span className="ml-1 text-xs text-stone-500">{describe(e.action, e.detail)}</span>}
                    {e.server_id !== '-' && <span className="ml-1 text-xs text-stone-400">on {e.server_id}</span>}
                  </Td>
                  <Td>
                    {e.outcome === 'ok' && e.run_id ? (
                      <Link to="/s/$server/runs/$id" params={{ server: e.server_id, id: e.run_id }} className="text-teal-700 hover:underline dark:text-teal-400">
                        <Badge tone="ok">{e.action === 'run.cancel' ? 'done' : 'started'}</Badge> view run
                      </Link>
                    ) : e.outcome === 'ok' ? (
                      <Badge tone="ok">done</Badge>
                    ) : e.outcome === 'rejected' ? (
                      <><Badge tone="fail">refused</Badge><p className="mt-1 text-xs text-red-700 dark:text-red-400">{e.error}</p></>
                    ) : (
                      <Badge tone="warn">no answer</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
