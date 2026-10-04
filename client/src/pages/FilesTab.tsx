import { useNavigate } from '@tanstack/react-router';
import type { UploadsResponse } from '@webddeploy/shared';
import { Camera, Download, FolderUp, Upload } from 'lucide-react';
import { useMemo, useRef, useState, type DragEvent } from 'react';
import { Badge, Button, Card, ConfirmButton, Empty, ErrorBox, Mono, Spinner, Td, Th, cx, inputClass } from '../components/ui.tsx';
import { ApiError, uploadFiles, uploadsDownloadUrl, useUploads, useUploadsRestore, useUploadsSnapshot } from '../lib/api.ts';
import { bytes, relativeTime } from '../lib/format.ts';
import { fromDrop, fromFiles, withoutTop, type Picked } from '../lib/pickFiles.ts';
import { buildTar } from '../lib/tar.ts';
import { useCan } from '../lib/role.tsx';
import { CopyFromServer } from './CopyFromServer.tsx';

export function FilesTab({ server, name }: { server: string; name: string }) {
  const uploads = useUploads(server, name);
  const navigate = useNavigate();
  const restore = useUploadsRestore(server);
  const snapshot = useUploadsSnapshot(server);
  const goRun = ({ run_id }: { run_id: string }) => void navigate({ to: '/s/$server/runs/$id', params: { server, id: run_id } });
  const canAct = useCan('admin');

  if (uploads.isPending) return <Spinner label="Reading the upload folders…" />;
  if (uploads.error) return <ErrorBox error={uploads.error} title="Couldn't read the upload folders" />;
  const u = uploads.data;

  return (
    <div className="space-y-4">
      {u.target !== name && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          This preview uses <strong>{u.target}</strong>'s uploaded files. Changes here change {u.target} and every preview of it.
        </div>
      )}
      {u.dirs.length === 0 ? (
        <Card className="p-4 text-sm text-stone-600 dark:text-stone-400">
          This site declares no upload folders (<Mono>upload_dirs</Mono> in <Mono>.ddev/config.yaml</Mono>), so there's nowhere to put files.
        </Card>
      ) : (
        u.dirs.map((d) => <UploadDir key={d.dir} server={server} name={name} dir={d} maxBytes={u.max_bytes} onStarted={goRun} />)
      )}
      {canAct && u.dirs.length > 0 && <CopyFromServer server={server} name={name} dirs={u.dirs.map((d) => d.dir)} onStarted={goRun} />}
      <Card
        title="Snapshots"
        actions={
          canAct ? (
            <Button busy={snapshot.isPending} onClick={() => snapshot.mutate({ site: name }, { onSuccess: goRun })}>
              <Camera className="size-4" aria-hidden /> Take snapshot
            </Button>
          ) : null
        }
      >
        <p className="border-b border-stone-200 px-4 py-2 text-xs text-stone-500 dark:border-stone-800">
          Taken automatically before every upload or restore; the newest few are kept. Hardlinks: free until files change. Restoring puts the
          folder back exactly as it was — and snapshots the current state first.
        </p>
        {(snapshot.error ?? restore.error) && <ErrorBox error={snapshot.error ?? restore.error} />}
        {u.snapshots.length === 0 ? (
          <Empty>No snapshots yet.</Empty>
        ) : (
          <table className="w-full">
            <thead className="border-b border-stone-200 dark:border-stone-800">
              <tr><Th>Taken</Th><Th>Folder</Th><Th>Why</Th><Th className="text-right">Actions</Th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {u.snapshots.map((s) => (
                <tr key={s.id}>
                  <Td><span title={s.created_at}>{relativeTime(s.created_at)}</span></Td>
                  <Td><Mono>{s.dir}</Mono></Td>
                  <Td><Badge tone="neutral">{{ 'pre-import': 'before an upload', 'pre-restore': 'before a restore', manual: 'manual' }[s.reason] ?? s.reason}</Badge></Td>
                  <Td className="text-right">
                    {canAct && <ConfirmButton label="Restore" busyLabel="Restoring…" confirmLabel={`Put ${s.dir} back as it was`} typeToConfirm={name} onConfirm={() => restore.mutateAsync({ site: name, body: { snapshot: s.id } }, { onSuccess: goRun })} />}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

type Dir = UploadsResponse['dirs'][number];

function UploadDir({ server, name, dir, maxBytes, onStarted }: { server: string; name: string; dir: Dir; maxBytes: number; onStarted: (r: { run_id: string }) => void }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [unwrap, setUnwrap] = useState(true);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [confirm, setConfirm] = useState('');
  const [over, setOver] = useState(false);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const archiveInput = useRef<HTMLInputElement>(null);
  const canAct = useCan('admin');

  const plan = useMemo(() => {
    if (!picked) return null;
    if (picked.kind === 'archive') return { body: picked.file as Blob, label: picked.file.name, count: 0, size: picked.file.size, sample: [] as string[] };
    const entries = picked.topFolder && unwrap ? withoutTop(picked.entries, picked.topFolder) : picked.entries;
    const size = entries.reduce((n, e) => n + e.file.size, 0);
    return {
      body: buildTar(entries),
      label: picked.topFolder ? `${picked.topFolder}/ (folder)` : `${entries.length} file(s)`,
      count: entries.length,
      size,
      sample: entries.slice(0, 3).map((e) => `${dir.dir}/${e.path}`),
    };
  }, [picked, unwrap, dir.dir]);

  const reset = () => {
    setPicked(null);
    setConfirm('');
    setError(null);
    setProgress(null);
  };
  const choose = (p: Picked | null) => {
    reset();
    if (!p) setError('Nothing to upload there (empty, or only system files like .DS_Store).');
    setPicked(p);
  };
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    setReading(true);
    try {
      choose(await fromDrop(e.dataTransfer));
    } finally {
      setReading(false);
    }
  };
  const tooBig = !!plan && plan.body.size > maxBytes;
  const ready = !!plan && !tooBig && progress === null && (mode === 'merge' || confirm === name);

  const start = () => {
    if (!plan) return;
    setError(null);
    setProgress(0);
    uploadFiles(server, name, dir.dir, mode, plan.body, plan.label, plan.count, setProgress).then(onStarted, (e: unknown) => {
      setProgress(null);
      setError(e instanceof ApiError ? e.message : String(e));
    });
  };

  return (
    <Card
      title={<><Mono>{dir.dir}</Mono> <span className="ml-2 font-normal text-stone-500">{dir.exists ? `${dir.files ?? 'many'} file(s) · ${dir.bytes == null ? 'size unknown' : bytes(dir.bytes)}` : 'empty'}</span></>}
      actions={
        canAct && dir.exists && (dir.files ?? 1) > 0 ? (
          <a href={uploadsDownloadUrl(server, name, dir.dir)} download>
            <Button variant="ghost"><Download className="size-4" aria-hidden /> Download .tar.gz</Button>
          </a>
        ) : null
      }
    >
      {canAct && <div className="space-y-3 p-4 text-sm">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => void onDrop(e)}
          data-testid={`drop-${dir.dir}`}
          className={cx(
            'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors',
            over ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/40' : 'border-stone-300 dark:border-stone-700',
          )}
        >
          <FolderUp className="size-6 text-stone-400" aria-hidden />
          <p className="text-stone-600 dark:text-stone-300">{reading ? 'Reading the folder…' : <>Drop a <strong>folder</strong>, files, or a <strong>.zip / .tar.gz</strong> here</>}</p>
          <div className="flex gap-2">
            <Button onClick={() => folderInput.current?.click()}>Choose folder</Button>
            <Button onClick={() => archiveInput.current?.click()}>Choose files or archive</Button>
          </div>
          <input
            ref={folderInput}
            type="file"
            className="hidden"
            aria-label={`Folder for ${dir.dir}`}
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            multiple
            onChange={(e) => choose(fromFiles([...(e.target.files ?? [])]))}
          />
          <input ref={archiveInput} type="file" className="hidden" multiple aria-label={`Files for ${dir.dir}`} onChange={(e) => choose(fromFiles([...(e.target.files ?? [])]))} />
        </div>

        {plan && picked && (
          <div className="space-y-3 rounded-md border border-stone-200 p-3 dark:border-stone-800">
            <p>
              <strong>{picked.kind === 'archive' ? plan.label : `${plan.count} file(s)`}</strong> — {bytes(plan.size)}
              {picked.kind === 'archive' && <span className="text-stone-500"> · unpacked on the server, after checking every entry</span>}
              {tooBig && <span className="text-red-700"> — over the {bytes(maxBytes)} limit (WEB_UPLOAD_MAX_MB)</span>}
            </p>
            {picked.kind === 'files' && picked.topFolder && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={unwrap} onChange={(e) => setUnwrap(e.target.checked)} />
                Upload what's inside <Mono>{picked.topFolder}/</Mono>, not the folder itself
              </label>
            )}
            {plan.sample.length > 0 && (
              <p className="text-xs text-stone-500">
                e.g. {plan.sample.map((p) => <Mono key={p} className="mr-2">{p}</Mono>)}
                {plan.count > plan.sample.length && '…'}
              </p>
            )}
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="sr-only">How</legend>
              <label className={cx('flex cursor-pointer gap-2 rounded-md border p-2', mode === 'merge' ? 'border-teal-600' : 'border-stone-200 dark:border-stone-700')}>
                <input type="radio" name={`mode-${dir.dir}`} checked={mode === 'merge'} onChange={() => setMode('merge')} aria-label="Merge" />
                <span><strong>Merge</strong><span className="block text-xs text-stone-500">Add these; files with the same path are replaced, everything else stays.</span></span>
              </label>
              <label className={cx('flex cursor-pointer gap-2 rounded-md border p-2', mode === 'replace' ? 'border-red-600' : 'border-stone-200 dark:border-stone-700')}>
                <input type="radio" name={`mode-${dir.dir}`} checked={mode === 'replace'} onChange={() => setMode('replace')} aria-label="Replace" />
                <span><strong>Replace</strong><span className="block text-xs text-stone-500">The folder becomes exactly this; files not in it are removed.</span></span>
              </label>
            </fieldset>
            {mode === 'replace' && (
              <label className="block">
                <span className="text-stone-600 dark:text-stone-400">Type <strong>{name}</strong> to confirm replacing <Mono>{dir.dir}</Mono>:</span>
                <input className={`${inputClass} mt-1`} value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Confirm site name" />
              </label>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button variant={mode === 'replace' ? 'danger' : 'primary'} disabled={!ready} onClick={start}>
                <Upload className="size-4" aria-hidden />
                {progress === null ? (mode === 'replace' ? `Replace ${dir.dir}` : `Upload to ${dir.dir}`) : `Uploading… ${Math.round(progress * 100)}%`}
              </Button>
              {progress === null && <Button variant="ghost" onClick={reset}>Cancel</Button>}
              <span className="text-xs text-stone-500">A snapshot of the folder is taken first.</span>
            </div>
            {progress !== null && (
              <div className="h-1.5 overflow-hidden rounded bg-stone-200 dark:bg-stone-800" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
                <div className="h-full bg-teal-600 transition-[width]" style={{ width: `${progress * 100}%` }} />
              </div>
            )}
          </div>
        )}
        {error && <p className="text-red-700">{error}</p>}
      </div>}
    </Card>
  );
}
