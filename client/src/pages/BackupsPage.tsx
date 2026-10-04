import { Link, useNavigate, useParams } from '@tanstack/react-router';
import type { SiteSummary } from '@webddeploy/shared';
import { Archive } from 'lucide-react';
import { Button, Card, Empty, ErrorBox, Mono, Spinner, Td, Th, cx, InlineError } from '../components/ui.tsx';
import { useBackupNow, useInfo, useSites } from '../lib/api.ts';
import { cronLabel } from '../lib/format.ts';
import { LastBackup } from './BackupsTab.tsx';
import { useCan } from '../lib/role.tsx';

/** What every site's backups did lately; back one up now. */
export function BackupsPage() {
  const { server } = useParams({ from: '/s/$server/backups' });
  const info = useInfo(server);
  const sites = useSites(server);
  const cfg = info.data?.backups;
  // Shared-mode previews have no backups of their own (they're the parent's).
  const rows = (sites.data?.sites ?? []).filter((s) => !(s.preview && s.preview.mode === 'shared'));
  const failing = rows.filter((s) => s.last_backups?.database?.phase === 'failed' || s.last_backups?.uploads?.phase === 'failed');

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Backups</h1>
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4 text-sm">
          <p className="text-xs uppercase tracking-wide text-stone-500">Object storage</p>
          <p className="mt-2 text-lg font-semibold">{cfg?.bucket ? <Mono className="text-lg">{cfg.bucket}</Mono> : 'not configured'}</p>
          {failing.length > 0 && <p className="mt-1 text-red-700">{failing.length} site(s) whose last backup failed</p>}
        </Card>
        <Card className="p-4 text-sm">
          <p className="text-xs uppercase tracking-wide text-stone-500">Databases</p>
          {cfg?.database.enabled ? (
            <>
              <p className="mt-2 font-medium">{cronLabel(cfg.database.schedule)}</p>
              <p className="text-stone-500">dumps kept {cfg.database.retention_days} days by default (per site in Settings)</p>
            </>
          ) : (
            <p className="mt-2 text-stone-500">off (DB_BACKUP_ENABLED)</p>
          )}
        </Card>
        <Card className="p-4 text-sm">
          <p className="text-xs uppercase tracking-wide text-stone-500">Files</p>
          {cfg?.uploads.enabled ? (
            <>
              <p className="mt-2 font-medium">{cronLabel(cfg.uploads.schedule)}</p>
              <p className="text-stone-500">{cfg.uploads.versions_days ? `changed/deleted files kept ${cfg.uploads.versions_days} days` : 'plain mirror (no versions)'}</p>
            </>
          ) : (
            <p className="mt-2 text-stone-500">off (BACKUP_ENABLED)</p>
          )}
        </Card>
      </div>
      <Card title="Sites">
        {sites.isPending ? (
          <Spinner />
        ) : sites.error ? (
          <ErrorBox error={sites.error} />
        ) : rows.length === 0 ? (
          <Empty>No sites.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem]">
              <thead className="border-b border-stone-200 dark:border-stone-800">
                <tr><Th>Site</Th><Th>Last database backup</Th><Th>Last files backup</Th><Th className="text-right">Back up now</Th></tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {rows.map((s) => <Row key={s.name} server={server} site={s} dbOn={!!cfg?.database.enabled} filesOn={!!cfg?.uploads.enabled} />)}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Row({ server, site, dbOn, filesOn }: { server: string; site: SiteSummary; dbOn: boolean; filesOn: boolean }) {
  const now = useBackupNow(server);
  const navigate = useNavigate();
  const canAct = useCan('admin');
  const failed = site.last_backups?.database?.phase === 'failed' || site.last_backups?.uploads?.phase === 'failed';
  const busy = (what: string) => now.isPending && (now.variables?.body as { what?: string } | undefined)?.what === what;
  const run = (what: 'database' | 'uploads') =>
    now.mutate({ site: site.name, body: { what } }, { onSuccess: ({ run_id }) => void navigate({ to: '/s/$server/runs/$id', params: { server, id: run_id } }) });
  return (
    <tr className={cx(failed && 'bg-red-50/50 dark:bg-red-950/20')}>
      <Td>
        <Link to="/s/$server/sites/$name" params={{ server, name: site.name }} search={{ tab: 'backups' }} className="font-medium hover:underline">{site.name}</Link>
      </Td>
      <Td>{dbOn ? <LastBackup event={site.last_backups?.database} /> : <span className="text-stone-400">off</span>}</Td>
      <Td>{filesOn ? <LastBackup event={site.last_backups?.uploads} /> : <span className="text-stone-400">off</span>}</Td>
      <Td className="text-right">
        <span className="inline-flex gap-2">
          {canAct && dbOn && <Button busy={busy('database')} onClick={() => run('database')}><Archive className="size-4" aria-hidden /> Database</Button>}
          {canAct && filesOn && <Button busy={busy('uploads')} onClick={() => run('uploads')}><Archive className="size-4" aria-hidden /> Files</Button>}
        </span>
        {now.error && <InlineError error={now.error} className="mt-1 text-xs text-red-700" />}
      </Td>
    </tr>
  );
}
