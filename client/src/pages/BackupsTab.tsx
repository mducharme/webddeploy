import { Link, useNavigate } from '@tanstack/react-router';
import type { BackupsResponse, DdeployEvent } from '@webddeploy/shared';
import { Archive, Database, Download, FolderSync, Pin, PinOff, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Trigger } from '../components/RunTable.tsx';
import { Badge, Button, Card, ConfirmButton, Empty, ErrorBox, Mono, Spinner, Td, Th } from '../components/ui.tsx';
import { backupDownloadUrl, useBackupNow, useBackupRestoreDb, useBackupRestoreUploads, useBackups, useManageBackup } from '../lib/api.ts';
import { bytes, cronLabel, dateTime, relativeTime } from '../lib/format.ts';
import { useCan } from '../lib/role.tsx';

export function LastBackup({ event, never = 'never' }: { event: DdeployEvent | null | undefined; never?: string }) {
  if (!event) return <span className="text-stone-400">{never}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <Badge tone={event.phase === 'succeeded' ? 'ok' : 'fail'}>{event.phase === 'succeeded' ? 'ok' : 'failed'}</Badge>
      <span title={event.ts}>{relativeTime(event.ts)}</span>
      <span className="text-xs"><Trigger trigger={event.trigger} /></span>
    </span>
  );
}

export function BackupsTab({ server, name }: { server: string; name: string }) {
  const backups = useBackups(server, name);
  if (backups.isPending) return <Spinner label="Reading backups from object storage…" />;
  if (backups.error) return <ErrorBox error={backups.error} title="Couldn't read the backups" />;
  const b = backups.data;
  if (b.shared_with_parent) {
    return (
      <Card className="p-4 text-sm">
        This preview uses <strong>{b.target}</strong>'s database and files, so it has no backups of its own.{' '}
        <Link to="/s/$server/sites/$name" params={{ server, name: b.target }} search={{ tab: 'backups' }} className="text-teal-700 hover:underline">
          See {b.target}'s backups
        </Link>
        .
      </Card>
    );
  }
  if (!b.configured) {
    return (
      <Card className="p-4 text-sm text-stone-600 dark:text-stone-400">
        Backups to object storage aren't set up on this server (<Mono>BACKUP_CREDENTIALS</Mono>, <Mono>BACKUP_BUCKET</Mono>,{' '}
        <Mono>DB_BACKUP_ENABLED</Mono>, <Mono>BACKUP_ENABLED</Mono> in <Mono>provisioner.conf</Mono>). Local snapshots on the Database and Files tabs still work.
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {b.error && <ErrorBox error={b.error} title="Object storage" />}
      <div className="grid gap-4 lg:grid-cols-2">
        <StatusCard
          server={server}
          name={name}
          what="database"
          icon={<Database className="size-4" aria-hidden />}
          title="Database"
          enabled={b.database.enabled}
          schedule={b.database.schedule}
          lastRun={b.database.last_run}
          lines={[
            `${b.database.dumps.length} dump(s) in ${b.bucket}`,
            <>
              Kept {b.database.retention_days ?? '?'} days{' '}
              <span className="text-stone-400">({b.database.retention_source === 'site' ? 'this site' : 'server default'})</span> ·{' '}
              <Link to="/s/$server/sites/$name" params={{ server, name }} search={{ tab: 'settings' }} className="text-teal-700 hover:underline">change</Link>
            </>,
          ]}
        />
        <StatusCard
          server={server}
          name={name}
          what="uploads"
          icon={<FolderSync className="size-4" aria-hidden />}
          title="Files"
          enabled={b.uploads.enabled}
          schedule={b.uploads.schedule}
          lastRun={b.uploads.last_run}
          lines={[
            b.uploads.mirror.map((m) => `${m.dir}: ${m.files ?? '?'} file(s), ${bytes(m.bytes)}`).join(' · ') || 'no upload folders',
            b.uploads.versions_days ? `Changed and deleted files kept ${b.uploads.versions_days} days` : 'Plain mirror: changed or deleted files are not kept (UPLOADS_BACKUP_VERSIONS_DAYS=0)',
          ]}
        />
      </div>
      <Dumps server={server} name={name} b={b} />
      <Files server={server} name={name} b={b} />
    </div>
  );
}

function StatusCard(props: {
  server: string;
  name: string;
  what: 'database' | 'uploads';
  icon: ReactNode;
  title: string;
  enabled: boolean;
  schedule: string;
  lastRun: DdeployEvent | null;
  lines: ReactNode[];
}) {
  const now = useBackupNow(props.server);
  const navigate = useNavigate();
  const canAct = useCan('admin');
  return (
    <Card
      title={<span className="flex items-center gap-2">{props.icon} {props.title}</span>}
      actions={
        props.enabled && canAct ? (
          <Button
            busy={now.isPending}
            onClick={() =>
              now.mutate({ site: props.name, body: { what: props.what } }, { onSuccess: ({ run_id }) => void navigate({ to: '/s/$server/runs/$id', params: { server: props.server, id: run_id } }) })
            }
          >
            <Archive className="size-4" aria-hidden /> Back up now
          </Button>
        ) : null
      }
    >
      <div className="space-y-1.5 p-4 text-sm">
        {props.enabled ? (
          <>
            <p>Last backup: <LastBackup event={props.lastRun} never="none recorded yet" /></p>
            {props.lastRun?.phase === 'failed' && props.lastRun.error && <p className="text-xs text-red-700">{props.lastRun.error}</p>}
            <p className="text-stone-600 dark:text-stone-400">Automatic: {cronLabel(props.schedule)}</p>
            {props.lines.map((l, i) => <p key={i} className="text-stone-600 dark:text-stone-400">{l}</p>)}
          </>
        ) : (
          <p className="text-stone-500">Off on this server ({props.what === 'database' ? 'DB_BACKUP_ENABLED' : 'BACKUP_ENABLED'}).</p>
        )}
        {now.error && <p className="text-red-700">{now.error.message}</p>}
      </div>
    </Card>
  );
}

function Dumps({ server, name, b }: { server: string; name: string; b: BackupsResponse }) {
  const restore = useBackupRestoreDb(server);
  const manage = useManageBackup(server, name);
  const navigate = useNavigate();
  const canAct = useCan('admin');
  const go = ({ run_id }: { run_id: string }) => void navigate({ to: '/s/$server/runs/$id', params: { server, id: run_id } });
  return (
    <Card title={`Database dumps (${b.database.dumps.length})`}>
      <p className="border-b border-stone-200 px-4 py-2 text-xs text-stone-500 dark:border-stone-800">
        Each backup deletes dumps older than {b.database.retention_days ?? '?'} days — except <strong>kept</strong> ones. Restoring replaces the
        database, after taking a local snapshot of it (Database tab), so it can be undone.
      </p>
      {(restore.error ?? manage.error) && <ErrorBox error={restore.error ?? manage.error} />}
      {b.database.dumps.length === 0 ? (
        <Empty>No dumps yet.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem]">
            <thead className="border-b border-stone-200 dark:border-stone-800">
              <tr><Th>Taken</Th><Th>Size</Th><Th /><Th className="text-right">{canAct ? 'Actions' : ''}</Th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {b.database.dumps.map((d) => (
                <tr key={d.file}>
                  <Td>
                    <div title={d.file}>{dateTime(d.created_at)}</div>
                    <div className="text-xs text-stone-500">{relativeTime(d.created_at)}</div>
                  </Td>
                  <Td className="tabular-nums">{bytes(d.bytes)}</Td>
                  <Td>{d.kept && <Badge tone="ok"><Pin className="size-3" aria-hidden /> kept</Badge>}</Td>
                  <Td className="text-right">
                    {canAct && <span className="inline-flex flex-wrap justify-end gap-1">
                      <a href={backupDownloadUrl(server, name, d.file)} download>
                        <Button variant="ghost" title="Download"><Download className="size-4" aria-hidden /><span className="sr-only">Download {d.file}</span></Button>
                      </a>
                      <Button
                        variant="ghost"
                        title={d.kept ? 'Let retention delete it again' : 'Keep: never deleted by retention'}
                        busy={manage.isPending && manage.variables?.file === d.file && manage.variables.action !== 'delete'}
                        onClick={() => manage.mutate({ action: d.kept ? 'unkeep' : 'keep', file: d.file })}
                      >
                        {d.kept ? <PinOff className="size-4" aria-hidden /> : <Pin className="size-4" aria-hidden />}
                        <span className="sr-only">{d.kept ? 'Stop keeping' : 'Keep'} {d.file}</span>
                      </Button>
                      <ConfirmButton label="Restore" confirmLabel="Replace the database with this" onConfirm={() => restore.mutate({ site: name, body: { file: d.file } }, { onSuccess: go })} />
                      <ConfirmButton label="Delete" confirmLabel="Delete this dump" icon={<Trash2 className="size-4" aria-hidden />} onConfirm={() => manage.mutate({ action: 'delete', file: d.file })} />
                    </span>}
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

function Files({ server, name, b }: { server: string; name: string; b: BackupsResponse }) {
  const restore = useBackupRestoreUploads(server);
  const [shown, setShown] = useState(8);
  const canAct = useCan('admin');
  const navigate = useNavigate();
  const go = ({ run_id }: { run_id: string }) => void navigate({ to: '/s/$server/runs/$id', params: { server, id: run_id } });
  return (
    <Card title="Files">
      <p className="border-b border-stone-200 px-4 py-2 text-xs text-stone-500 dark:border-stone-800">
        The backup mirrors each upload folder. Restoring a folder replaces it with the mirror. Each backup run also keeps the files it overwrote or
        deleted{b.uploads.versions_days ? ` (for ${b.uploads.versions_days} days)` : ''}: bringing a version back puts those files back, leaving the
        rest. A local snapshot (Files tab) is taken first either way.
      </p>
      {restore.error && <ErrorBox error={restore.error} />}
      <div className="divide-y divide-stone-100 dark:divide-stone-800">
        {b.uploads.mirror.map((m) => (
          <div key={m.dir} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
            <span><Mono>{m.dir}</Mono> <span className="text-stone-500">— backup: {m.files ?? '?'} file(s), {bytes(m.bytes)}</span></span>
            {canAct && <ConfirmButton
              label="Restore folder"
              confirmLabel={`Replace ${m.dir} with the backup`}
              disabled={!m.files}
              onConfirm={() => restore.mutate({ site: name, body: { dir: m.dir } }, { onSuccess: go })}
            />}
          </div>
        ))}
      </div>
      <p className="border-t border-stone-200 px-4 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-stone-500 dark:border-stone-800">Versions</p>
      {b.uploads.versions.length === 0 ? (
        <Empty>No versions yet: a backup keeps one only when it overwrote or deleted something.</Empty>
      ) : (
        <table className="w-full">
          <thead className="border-b border-stone-200 dark:border-stone-800">
            <tr><Th>Backup run</Th><Th className="text-right">Bring back what it overwrote or deleted</Th></tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
            {b.uploads.versions.slice(0, shown).map((v) => (
              <tr key={v.id}>
                <Td>
                  <div>{dateTime(v.created_at)}</div>
                  <div className="text-xs text-stone-500">{relativeTime(v.created_at)}</div>
                </Td>
                <Td className="text-right">
                  <span className="inline-flex flex-wrap justify-end gap-2">
                    {canAct && v.dirs.map((d) => (
                      <ConfirmButton key={d} label={d} confirmLabel={`Bring back ${d} files`} onConfirm={() => restore.mutate({ site: name, body: { dir: d, version: v.id } }, { onSuccess: go })} />
                    ))}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {b.uploads.versions.length > shown && (
        <div className="border-t border-stone-100 p-2 text-center dark:border-stone-800">
          <button type="button" onClick={() => setShown((n) => n + 20)} className="text-sm text-teal-700 hover:underline dark:text-teal-400">
            Show more ({b.uploads.versions.length - shown} older)
          </button>
        </div>
      )}
    </Card>
  );
}
