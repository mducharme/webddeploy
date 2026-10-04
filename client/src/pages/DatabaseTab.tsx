import { useNavigate } from '@tanstack/react-router';
import type { DbCredentialsResponse } from '@webddeploy/shared';
import { Camera, Download, KeyRound, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Badge, Button, Card, ConfirmButton, Empty, ErrorBox, Mono, Spinner, Td, Th, inputClass } from '../components/ui.tsx';
import { ApiError, dbDumpUrl, fetchDbCredentials, uploadDump, useDbInfo, useDbRestore, useDbSnapshot, useInfo } from '../lib/api.ts';
import { bytes, relativeTime } from '../lib/format.ts';

export function DatabaseTab({ server, name }: { server: string; name: string }) {
  const db = useDbInfo(server, name);
  const info = useInfo(server);
  const navigate = useNavigate();
  const restore = useDbRestore(server);
  const snapshot = useDbSnapshot(server);
  const [creds, setCreds] = useState<DbCredentialsResponse | null>(null);
  const [credsError, setCredsError] = useState<string | null>(null);

  if (db.isPending) return <Spinner label="Reading the database…" />;
  if (db.error) return <ErrorBox error={db.error} title="Couldn't read the database" />;
  const d = db.data;
  const goRun = ({ run_id }: { run_id: string }) => void navigate({ to: '/s/$server/runs/$id', params: { server, id: run_id } });

  return (
    <div className="space-y-4">
      {d.target !== name && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          This preview shares <strong>{d.target}</strong>'s database. Importing or restoring here changes {d.target} and every preview of it.
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-stone-500">Database</p>
          <p className="mt-2 text-lg font-semibold"><Mono className="text-lg">{d.database}</Mono></p>
          <p className="mt-1 text-sm text-stone-500">
            {d.error ? <span className="text-red-700">{d.error}</span> : <>{d.table_count} table{d.table_count === 1 ? '' : 's'} · {bytes(d.size_bytes)} · on {d.host}</>}
          </p>
        </Card>
        <Card className="p-4 lg:col-span-2">
          <p className="text-xs uppercase tracking-wide text-stone-500">Connect from your machine</p>
          {creds ? (
            <div className="mt-2 space-y-2 text-sm">
              <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1">
                <dt className="text-stone-500">Host</dt><dd><Mono>{creds.host}:{creds.port}</Mono></dd>
                <dt className="text-stone-500">Database</dt><dd><Mono>{creds.database}</Mono></dd>
                <dt className="text-stone-500">User</dt><dd><Mono>{creds.user}</Mono></dd>
                <dt className="text-stone-500">Password</dt><dd><Mono className="select-all">{creds.password}</Mono></dd>
              </dl>
              <p className="text-stone-500">Through an SSH tunnel (the database isn't exposed publicly):</p>
              <pre className="overflow-x-auto rounded bg-stone-950 p-2 font-mono text-xs text-stone-100">
                {`ssh -N -L 3307:${creds.host === '127.0.0.1' || creds.host === 'localhost' ? '127.0.0.1' : creds.host}:${creds.port} deploy@${info.data?.hostname ?? '<server>'}\nmysql -h 127.0.0.1 -P 3307 -u ${creds.user} -p ${creds.database}`}
              </pre>
              <Button variant="ghost" onClick={() => setCreds(null)}>Hide</Button>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button
                onClick={() =>
                  fetchDbCredentials(server, name).then(setCreds, (e: Error) => setCredsError(e.message))
                }
              >
                <KeyRound className="size-4" aria-hidden /> Show connection details
              </Button>
              <span className="text-xs text-stone-500">The site's own database user. Revealing it is recorded in the activity log.</span>
              {credsError && <span className="text-sm text-red-700">{credsError}</span>}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Export">
          <div className="space-y-3 p-4 text-sm">
            <p className="text-stone-600 dark:text-stone-400">A gzipped mysqldump of the live database (consistent, without locking the site).</p>
            <a href={dbDumpUrl(server, name)} download>
              <Button><Download className="size-4" aria-hidden /> Download dump</Button>
            </a>
          </div>
        </Card>
        <ImportCard server={server} name={name} maxBytes={info.data?.limits?.db_import_max_bytes} onStarted={goRun} />
      </div>

      <Card
        title="Snapshots"
        actions={
          <Button busy={snapshot.isPending} onClick={() => snapshot.mutate({ site: name }, { onSuccess: goRun })}>
            <Camera className="size-4" aria-hidden /> Take snapshot
          </Button>
        }
      >
        <p className="border-b border-stone-200 px-4 py-2 text-xs text-stone-500 dark:border-stone-800">
          Local safety copies, taken automatically before every import or restore (the newest few are kept). Restoring one replaces the
          database — and takes a snapshot of the current state first, so that can be undone too.
        </p>
        {snapshot.error && <ErrorBox error={snapshot.error} />}
        {restore.error && <ErrorBox error={restore.error} title="Couldn't start the restore" />}
        {d.snapshots.length === 0 ? (
          <Empty>No snapshots yet.</Empty>
        ) : (
          <table className="w-full">
            <thead className="border-b border-stone-200 dark:border-stone-800">
              <tr><Th>Taken</Th><Th>Why</Th><Th>Size</Th><Th className="text-right">Actions</Th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {d.snapshots.map((s) => (
                <tr key={s.id}>
                  <Td><span title={s.created_at}>{relativeTime(s.created_at)}</span></Td>
                  <Td><Badge tone="neutral">{s.reason === 'pre-import' ? 'before an import' : s.reason}</Badge></Td>
                  <Td>{bytes(s.bytes)}</Td>
                  <Td className="text-right">
                    <span className="inline-flex flex-wrap justify-end gap-2">
                      <a href={dbDumpUrl(server, name, s.id)} download>
                        <Button variant="ghost"><Download className="size-4" aria-hidden /> Download</Button>
                      </a>
                      <ConfirmButton label="Restore" busyLabel="Restoring…" confirmLabel={`Replace ${d.database} with this`} onConfirm={() => restore.mutateAsync({ site: name, body: { snapshot: s.id } }, { onSuccess: goRun })} />
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {d.tables.length > 0 && (
        <Card title={`Tables (${d.table_count})`}>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
                <tr><Th>Table</Th><Th className="text-right">Rows (approx.)</Th><Th className="text-right">Size</Th></tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {d.tables.map((t) => (
                  <tr key={t.name}>
                    <Td><Mono>{t.name}</Mono></Td>
                    <Td className="text-right tabular-nums">{t.rows?.toLocaleString() ?? '—'}</Td>
                    <Td className="text-right tabular-nums">{bytes(t.bytes)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function ImportCard({ server, name, maxBytes, onStarted }: { server: string; name: string; maxBytes?: number; onStarted: (r: { run_id: string }) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [confirm, setConfirm] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const tooBig = !!(file && maxBytes && file.size > maxBytes);

  const start = () => {
    if (!file) return;
    setError(null);
    setProgress(0);
    uploadDump(server, name, file, setProgress).then(onStarted, (e: unknown) => {
      setProgress(null);
      setError(e instanceof ApiError ? e.message : String(e));
    });
  };

  return (
    <Card title="Import">
      <div className="space-y-3 p-4 text-sm">
        <p className="text-stone-600 dark:text-stone-400">
          Replaces the whole database with a <Mono>.sql</Mono> or <Mono>.sql.gz</Mono> dump (e.g. <Mono>ddev export-db</Mono>). A snapshot of the
          current database is taken first.
        </p>
        <input ref={input} type="file" accept=".sql,.gz,.sql.gz,application/gzip,application/sql" className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-stone-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-stone-100 dark:file:border-stone-700 dark:file:bg-stone-900" aria-label="Dump file" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setConfirm(''); setError(null); }} />
        {file && (
          <>
            <p className={tooBig ? 'text-red-700' : 'text-stone-500'}>
              {file.name} — {bytes(file.size)}
              {tooBig && ` — over the ${bytes(maxBytes)} limit (WEB_IMPORT_MAX_MB)`}
            </p>
            <label className="block">
              <span className="text-stone-600 dark:text-stone-400">Type <strong>{name}</strong> to confirm:</span>
              <input className={`${inputClass} mt-1`} value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Confirm site name" />
            </label>
            <Button variant="danger" disabled={confirm !== name || tooBig || progress !== null} onClick={start}>
              <Upload className="size-4" aria-hidden /> {progress === null ? 'Replace the database' : `Uploading… ${Math.round(progress * 100)}%`}
            </Button>
          </>
        )}
        {error && <p className="text-red-700">{error}</p>}
      </div>
    </Card>
  );
}
