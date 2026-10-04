import type { ConfigFileResponse, ConfigFilesResponse } from '@webddeploy/shared';
import { FileCog, KeyRound, RotateCcw, Save } from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, ConfirmButton, ErrorBox, InlineError, Mono, Spinner, Td, Th } from '../components/ui.tsx';
import { ApiError, useConfigFiles, useOpenConfigFile, useRestoreConfigFile, useSaveConfigFile } from '../lib/api.ts';
import { bytes, dateTime } from '../lib/format.ts';

type Format = ConfigFileResponse['format'];

const FORMAT_LABELS: Record<Format, string> = { json: 'JSON', yaml: 'YAML', php: 'PHP', env: 'env', ini: 'ini', text: 'text' };

/** What's wrong with `text` as `format`, checked in the browser (JSON only; ddeploy checks the rest on save). */
export function localCheck(text: string, format: Format): string | null {
  if (format !== 'json') return null;
  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    return `invalid JSON: ${(e as Error).message}`;
  }
}

/** Pretty-printed JSON, keeping the file's indentation width (2 spaces when it can't tell). */
export function formatJson(text: string): string {
  return `${JSON.stringify(JSON.parse(text), null, indentOf(text))}\n`;
}

/** The file's indentation width, so the tree view writes it back the same way (2 when it can't tell). */
export function indentOf(text: string): number {
  return /\n( +)"/.exec(text)?.[1]?.length ?? 2;
}

// Editors load only when a file is opened: they're the heaviest part of the UI.
const JsonEditor = lazy(() => import('../components/editors/JsonEditor.tsx'));
const CodeEditor = lazy(() => import('../components/editors/CodeEditor.tsx'));

/** "20261004T040106Z" → a Date. */
const versionDate = (id: string) => new Date(`${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}T${id.slice(9, 11)}:${id.slice(11, 13)}:${id.slice(13, 15)}Z`);

export function ConfigFiles({ server, name }: { server: string; name: string }) {
  const files = useConfigFiles(server, name);
  const [openPath, setOpenPath] = useState<string | null>(null);
  if (files.isPending) return <Spinner label="Looking for config files…" />;
  if (files.error) return <ErrorBox error={files.error} title="Couldn't list the config files" />;
  if (files.data.files.length === 0) return null;
  return (
    <Card title={<span className="flex items-center gap-2"><FileCog className="size-4" aria-hidden /> Config files</span>}>
      <p className="border-b border-stone-200 px-4 py-2 text-xs text-stone-500 dark:border-stone-800">
        Files the site reads its settings from, kept outside the releases: deploys never overwrite them. Changes apply on the site's next request; the
        previous version is kept, to put back.
      </p>
      <table className="w-full">
        <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
          {files.data.files.map((f) => (
            <tr key={f.path}>
              <Td>
                <Mono>{f.path}</Mono>{' '}
                <Badge tone="neutral">{FORMAT_LABELS[f.format]}</Badge>{' '}
                {f.credential && <Badge tone="warn"><KeyRound className="size-3" aria-hidden /> database credentials</Badge>}
              </Td>
              <Td className="text-xs text-stone-500">{f.exists ? bytes(f.size) : "doesn't exist yet"}</Td>
              <Td className="text-right">
                <Button variant={openPath === f.path ? 'primary' : 'secondary'} onClick={() => setOpenPath(openPath === f.path ? null : f.path)}>
                  {openPath === f.path ? 'Close' : f.exists ? 'Open' : 'Create'}
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
      {openPath && (
        <FileEditor key={openPath} server={server} name={name} file={files.data.files.find((f) => f.path === openPath)!} target={files.data.target} />
      )}
    </Card>
  );
}

function FileEditor({ server, name, file, target }: { server: string; name: string; file: ConfigFilesResponse['files'][number]; target: string }) {
  const open = useOpenConfigFile(server, name);
  const save = useSaveConfigFile(server, name);
  const restore = useRestoreConfigFile(server, name);
  const [loaded, setLoaded] = useState<ConfigFileResponse | null>(null);
  const [text, setText] = useState('');

  const load = () =>
    open.mutate(file.path, {
      onSuccess: (r) => {
        setLoaded(r);
        setText(r.content);
      },
    });
  // Opened on purpose: the content can hold the database password.
  useEffect(() => {
    if (!file.exists) {
      setLoaded({ api_version: 1, path: file.path, format: file.format, exists: false, size: 0, sha256: '', content: '', versions: [] });
      setText(file.format === 'json' ? '{\n}\n' : '');
    }
  }, [file]);

  const problem = useMemo(() => localCheck(text, file.format), [text, file.format]);
  const dirty = loaded !== null && text !== loaded.content;
  const conflict = save.error instanceof ApiError && save.error.status === 409;

  if (!loaded) {
    return (
      <div className="space-y-2 border-t border-stone-200 p-4 text-sm dark:border-stone-800">
        <p className="text-stone-600 dark:text-stone-400">
          {file.credential ? 'This file holds the database password. ' : 'It may hold passwords or keys. '}
          Opening it is recorded in the activity log.
        </p>
        <Button variant="primary" busy={open.isPending} onClick={load}>Show {file.path}</Button>
        {open.error && <ErrorBox error={open.error} title={`Couldn't open ${file.path}`} />}
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t border-stone-200 p-4 text-sm dark:border-stone-800">
      {target !== name && (
        <p className="rounded-md bg-amber-50 p-2 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          This preview uses <strong>{target}</strong>'s files: saving changes {target} too.
        </p>
      )}
      {file.credential && (
        <p className="rounded-md bg-amber-50 p-2 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          ddeploy wrote the database connection here (<Mono>databases.*</Mono>) and reads the password back from it for backups, dumps and imports.
          Leave those values as they are; everything else is yours to change.
        </p>
      )}
      <Suspense fallback={<Spinner label="Loading the editor…" />}>
        {file.format === 'json' ? (
          <JsonEditor value={text} onChange={setText} indent={indentOf(loaded.content)} />
        ) : (
          <CodeEditor value={text} onChange={setText} format={file.format} label={`Content of ${file.path}`} />
        )}
      </Suspense>
      {problem && <p className="text-xs text-red-700 dark:text-red-400">{problem}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          disabled={!dirty || !!problem}
          busy={save.isPending}
          onClick={() =>
            save.mutate(
              { path: file.path, content: text, expect_sha: loaded.exists ? loaded.sha256 : undefined },
              { onSuccess: load },
            )
          }
        >
          <Save className="size-4" aria-hidden /> Save {file.path}
        </Button>
        {dirty && <Button variant="ghost" onClick={() => setText(loaded.content)}>Discard changes</Button>}
        <span className="text-xs text-stone-500">
          {file.format === 'json' ? 'Tree or text view (top-left of the editor); Format and Compact in its menu' : `${FORMAT_LABELS[file.format]}${file.format === 'php' ? ' — checked with php -l before saving (nothing is run)' : ' — checked before saving'}`}
        </span>
      </div>
      {save.error && (
        <div className="space-y-1">
          <InlineError error={save.error} className="text-sm text-red-700" />
          {conflict && <Button onClick={load} busy={open.isPending}>Reload {file.path} (your changes are lost)</Button>}
        </div>
      )}
      {loaded.versions.length > 0 && (
        <div>
          <p className="pb-1 text-xs font-medium uppercase tracking-wide text-stone-500">Previous versions</p>
          <table className="w-full">
            <thead className="border-b border-stone-200 dark:border-stone-800">
              <tr><Th>Replaced</Th><Th>By</Th><Th>Size</Th><Th /></tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {loaded.versions.map((v) => (
                <tr key={v.id}>
                  <Td className="text-xs">{dateTime(versionDate(v.id).toISOString())}</Td>
                  <Td className="text-xs text-stone-500">{v.by || '—'}</Td>
                  <Td className="text-xs text-stone-500">{bytes(v.size)}</Td>
                  <Td className="text-right">
                    <ConfirmButton
                      label="Restore"
                      busyLabel="Restoring…"
                      confirmLabel="Put this version back"
                      icon={<RotateCcw className="size-4" aria-hidden />}
                      onConfirm={() => restore.mutateAsync({ path: file.path, version: v.id }, { onSuccess: load })}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          {restore.error && <InlineError error={restore.error} className="text-sm text-red-700" />}
        </div>
      )}
    </div>
  );
}
