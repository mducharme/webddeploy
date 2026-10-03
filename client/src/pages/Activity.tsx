import { Link } from '@tanstack/react-router';
import { Badge, Card, Empty, ErrorBox, Mono, Spinner, Td, Th } from '../components/ui.tsx';
import { useActivity } from '../lib/api.ts';
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
  return parts.join(' · ');
}

export function ActivityPage() {
  const activity = useActivity();
  return (
    <Card title="Activity — actions taken from the web UI">
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
                    <span className="ml-1 text-xs text-stone-400">on {e.server_id}</span>
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
