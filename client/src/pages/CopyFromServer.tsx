import { fetchSource, patterns, type FetchTestResponse } from '@webddeploy/shared';
import { Check, Copy, KeyRound, Server, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, Card, ErrorBox, Field, Mono, cx, inputClass, InlineError } from '../components/ui.tsx';
import { useFetchKey, useFetchTest, useForgetHost, useUploadsFetch } from '../lib/api.ts';
import { bytes } from '../lib/format.ts';

/** The authorized_keys line for the other server: read-only and bound to `folder` when rrsync is used. */
export function authorizedKeysLine(publicKey: string, folder: string, rrsync: boolean): string {
  return rrsync ? `command="rrsync -ro ${folder.trim() || '/path/to/uploads'}",restrict ${publicKey}` : `restrict ${publicKey}`;
}

/** What to show after a test: the next step the admin has to take. */
export function nextStep(t: FetchTestResponse | undefined): 'test' | 'confirm' | 'changed' | 'fix' | 'copy' {
  if (!t) return 'test';
  if (t.host_key.status === 'unknown' && !t.error) return 'confirm';
  if (t.host_key.status === 'changed') return 'changed';
  if (t.error || t.files == null) return 'fix';
  return 'copy';
}

function CopyText({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="ghost"
      title={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      <span className="sr-only">{label}</span>
    </Button>
  );
}

export function CopyFromServer({ server, name, dirs, onStarted }: { server: string; name: string; dirs: string[]; onStarted: (r: { run_id: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [folder, setFolder] = useState('');
  const [rrsync, setRrsync] = useState(true);
  const [dir, setDir] = useState(dirs[0] ?? '');
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [confirm, setConfirm] = useState('');
  const key = useFetchKey(server, open);
  const test = useFetchTest(server, name);
  const forget = useForgetHost(server);
  const copy = useUploadsFetch(server);

  // With an rrsync-bound key the other server already knows the folder: the path asked for is its root.
  const source = useMemo(() => ({ user: user.trim(), host: host.trim(), port: Number(port) || 0, path: rrsync ? '' : folder.trim() }), [user, host, port, folder, rrsync]);
  const parsed = fetchSource.safeParse(source);
  const folderError = folder && !(patterns.sshPath.test(folder.trim()) && !folder.trim().startsWith('-') && !`/${folder.trim()}/`.includes('/../'))
    ? 'letters, digits and . _ / @ + ~ - only, no ..'
    : null;
  // Shown once something's typed in the field, not on an empty form.
  const fieldError = (f: 'user' | 'host' | 'port') => {
    if (!{ user, host, port }[f].trim() || parsed.success) return null;
    return parsed.error.issues.find((i) => i.path[0] === f)?.message ?? null;
  };

  // Any change to where we copy from invalidates the last test.
  const { reset } = test;
  useEffect(() => reset(), [source.user, source.host, source.port, source.path, reset]);

  const t = test.data;
  const step = nextStep(t);
  const preferred = t?.host_key.fingerprints.find((f) => f.type === 'ED25519') ?? t?.host_key.fingerprints[0];
  const canTest = parsed.success && !folderError && (!rrsync || !!folder.trim());
  const ready = step === 'copy' && !!dir && (mode === 'merge' || confirm === name);

  if (!open) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <span className="flex items-start gap-3">
          <Server className="mt-0.5 size-5 shrink-0 text-stone-400" aria-hidden />
          <span>
            <span className="font-medium">Copy from another server</span>
            <span className="block text-stone-500">Pull an upload folder straight from the old host over SSH — nothing to download and re-upload.</span>
          </span>
        </span>
        <Button onClick={() => setOpen(true)}>Set up a copy</Button>
      </Card>
    );
  }

  return (
    <Card title={<span className="flex items-center gap-2"><Server className="size-4" aria-hidden /> Copy from another server</span>} actions={<Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>}>
      <div className="space-y-5 p-4 text-sm">
        <section className="space-y-2">
          <h3 className="font-medium">1. Where the files are</h3>
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr_6rem]">
            <Field label="Login" error={fieldError('user')}>
              <input className={inputClass} value={user} onChange={(e) => setUser(e.target.value)} placeholder="deploy" autoComplete="off" aria-label="SSH login" />
            </Field>
            <Field label="Host" error={fieldError('host')}>
              <input className={inputClass} value={host} onChange={(e) => setHost(e.target.value)} placeholder="old-server.example.com" autoComplete="off" aria-label="SSH host" />
            </Field>
            <Field label="Port" error={fieldError('port')}>
              <input className={inputClass} value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" aria-label="SSH port" />
            </Field>
          </div>
          <Field label="Folder on that server" error={folderError} hint="Absolute, like /var/www/site/web/uploads.">
            <input className={cx(inputClass, 'font-mono')} value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="/var/www/site/web/uploads" autoComplete="off" aria-label="Remote folder" />
          </Field>
        </section>

        <section className="space-y-2">
          <h3 className="flex items-center gap-2 font-medium"><KeyRound className="size-4" aria-hidden /> 2. Let this server in, read-only</h3>
          <p className="text-stone-600 dark:text-stone-400">
            On {host.trim() || 'the other server'}, add this line to <Mono>~/.ssh/authorized_keys</Mono> of <Mono>{user.trim() || 'that login'}</Mono>:
          </p>
          {key.error ? (
            <ErrorBox error={key.error} title="Couldn't read this server's key" />
          ) : (
            <div className="flex items-start gap-2 rounded-md bg-stone-100 p-2 dark:bg-stone-800">
              <code className="min-w-0 flex-1 break-all font-mono text-xs" data-testid="authorized-keys-line">
                {key.data ? authorizedKeysLine(key.data.public_key, folder, rrsync) : 'Loading…'}
              </code>
              {key.data && <CopyText text={authorizedKeysLine(key.data.public_key, folder, rrsync)} label="Copy the line" />}
            </div>
          )}
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={rrsync} onChange={(e) => setRrsync(e.target.checked)} />
            <span>
              Bind the key to that folder with <Mono>rrsync</Mono> (recommended)
              <span className="block text-xs text-stone-500">
                The key can then only read that folder: no shell, no writes. Needs rsync 3.2.4+ over there (Ubuntu 22.04+, Debian 12+). Without it, the
                key can log in as {user.trim() || 'that login'}.
              </span>
            </span>
          </label>
          {key.data?.server_ip && (
            <p className="text-xs text-stone-500">
              This server connects from <Mono>{key.data.server_ip}</Mono> — if the other server has a firewall, allow SSH from it.
            </p>
          )}
          {key.data && !key.data.rsync && <p className="text-xs text-amber-700">rsync isn't installed on this server yet — re-run ddeploy init.</p>}
        </section>

        <section className="space-y-3">
          <h3 className="font-medium">3. Test, then copy</h3>
          <div className="flex flex-wrap items-center gap-3">
            <Button busy={test.isPending && !test.variables?.accept} disabled={!canTest || test.isPending} onClick={() => test.mutate({ source })}>
              Test connection
            </Button>
            {!canTest && <span className="text-xs text-stone-500">Fill in the login, host and folder first.</span>}
          </div>
          {test.error && <ErrorBox error={test.error} />}

          {step === 'confirm' && t && preferred && (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
              <p className="flex items-center gap-2 font-medium"><ShieldAlert className="size-4" aria-hidden /> First connection to {t.host}: is this its key?</p>
              <p className="font-mono text-xs break-all" data-testid="fingerprint">{preferred.type} {preferred.fingerprint}</p>
              <p className="text-xs text-stone-600 dark:text-stone-400">
                Check it on {t.host}: <Mono>ssh-keygen -lf /etc/ssh/ssh_host_{preferred.type.toLowerCase()}_key.pub</Mono>. Remembered once confirmed; a
                different key later is refused.
              </p>
              <Button variant="primary" busy={test.isPending} onClick={() => test.mutate({ source, accept: preferred.fingerprint })}>
                <ShieldCheck className="size-4" aria-hidden /> That's the right key — continue
              </Button>
            </div>
          )}

          {step === 'changed' && t && (
            <div className="space-y-2 rounded-md border border-red-300 bg-red-50 p-3 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              <p className="font-medium">{t.host} presents a different key than the one remembered.</p>
              <p className="text-xs">Expected if that server was reinstalled; otherwise, something is in the way. Forget the old key only if you know why it changed.</p>
              <Button busy={forget.isPending} onClick={() => forget.mutate({ host: t.host, port: t.port }, { onSuccess: () => test.mutate({ source }) })}>
                Forget the old key
              </Button>
              {forget.error && <InlineError error={forget.error} className="text-xs" />}
            </div>
          )}

          {step === 'fix' && t?.error && <p className="rounded-md bg-red-50 p-3 text-red-800 dark:bg-red-950/40 dark:text-red-200">{t.error}</p>}

          {step === 'copy' && t && (
            <div className="space-y-3 rounded-md border border-stone-200 p-3 dark:border-stone-800">
              <p className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-emerald-600" aria-hidden />
                Connected: <strong>{t.files} file(s), {bytes(t.bytes)}</strong> to copy. Links and special files are skipped.
              </p>
              {dirs.length > 1 && (
                <Field label="Into">
                  <select className={inputClass} value={dir} onChange={(e) => setDir(e.target.value)} aria-label="Target upload folder">
                    {dirs.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </Field>
              )}
              <fieldset className="grid gap-2 sm:grid-cols-2">
                <legend className="sr-only">How</legend>
                <label className={cx('flex cursor-pointer gap-2 rounded-md border p-2', mode === 'merge' ? 'border-teal-600' : 'border-stone-200 dark:border-stone-700')}>
                  <input type="radio" name="fetch-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} aria-label="Merge" />
                  <span><strong>Merge</strong><span className="block text-xs text-stone-500">Add these; same paths are replaced, everything else stays.</span></span>
                </label>
                <label className={cx('flex cursor-pointer gap-2 rounded-md border p-2', mode === 'replace' ? 'border-red-600' : 'border-stone-200 dark:border-stone-700')}>
                  <input type="radio" name="fetch-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} aria-label="Replace" />
                  <span><strong>Replace</strong><span className="block text-xs text-stone-500"><Mono>{dir}</Mono> becomes exactly this copy.</span></span>
                </label>
              </fieldset>
              {mode === 'replace' && (
                <label className="block">
                  <span className="text-stone-600 dark:text-stone-400">Type <strong>{name}</strong> to confirm replacing <Mono>{dir}</Mono>:</span>
                  <input className={`${inputClass} mt-1`} value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Confirm site name" />
                </label>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant={mode === 'replace' ? 'danger' : 'primary'}
                  disabled={!ready}
                  busy={copy.isPending}
                  onClick={() => copy.mutate({ site: name, body: { dir, mode, source } }, { onSuccess: onStarted })}
                >
                  Copy {t.files} file(s) into {dir}
                </Button>
                <span className="text-xs text-stone-500">A snapshot of the folder is taken first.</span>
              </div>
              {copy.error && <ErrorBox error={copy.error} />}
            </div>
          )}
        </section>
      </div>
    </Card>
  );
}
