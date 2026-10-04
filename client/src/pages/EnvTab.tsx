import { SECRET_KEY, needsQuotes } from '@webddeploy/shared';
import { Eye, EyeOff, Plus, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, ErrorBox, Mono, Spinner, cx, inputClass, InlineError } from '../components/ui.tsx';
import { revealEnv, useApplyEnv, useEnv } from '../lib/api.ts';
import { applyPasted, diff, parsePasted, rowError, rowsFrom, type EnvRow } from '../lib/envEdit.ts';
import { DeployNowButton } from './siteShared.tsx';

export function EnvTab({ server, name, isPreview }: { server: string; name: string; isPreview: boolean }) {
  const env = useEnv(server, name);
  const apply = useApplyEnv(server, name);
  const [rows, setRows] = useState<EnvRow[]>([]);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealing, setRevealing] = useState<string | null>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (env.data) setRows(rowsFrom(env.data.entries));
  }, [env.data]);

  const change = useMemo(() => diff(rows), [rows]);
  const dirty = Object.keys(change.set).length + change.unset.length > 0;
  const invalid = rows.some((r) => rowError(r, rows));

  if (env.isPending) return <Spinner label="Reading .env…" />;
  if (env.error) return <ErrorBox error={env.error} title="Couldn't read this site's .env" />;

  const update = (i: number, patch: Partial<EnvRow>) => {
    setSaved(false);
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  const reveal = async (key: string) => {
    if (revealed[key] !== undefined) {
      setRevealed(({ [key]: _, ...rest }) => rest);
      return;
    }
    setRevealing(key);
    try {
      const r = await revealEnv(server, name, key);
      setRevealed((v) => ({ ...v, [key]: r.value }));
    } finally {
      setRevealing(null);
    }
  };

  const save = () =>
    apply.mutate(change, {
      onSuccess: () => {
        setRevealed({});
        setSaved(true);
      },
    });

  return (
    <div className="space-y-4">
      <Card
        title={<>Environment <span className="ml-1 font-normal text-stone-500">.env</span></>}
        actions={
          <div className="flex gap-2">
            <Button onClick={() => setPaste(paste === null ? '' : null)}>Paste .env</Button>
            <Button
              onClick={() => {
                setSaved(false);
                setRows((rs) => [...rs, { key: '', original: null, masked: false, managed: false, length: 0, draft: '', deleted: false, isNew: true }]);
              }}
            >
              <Plus className="size-4" aria-hidden /> Add variable
            </Button>
          </div>
        }
      >
        <p className="border-b border-stone-200 px-4 py-2 text-xs text-stone-500 dark:border-stone-800">
          The persistent copy every release links to (<Mono>{env.data.path}</Mono>). PHP reads it on every request, so changes are live
          immediately — unless the app caches its config (Laravel <Mono>config:cache</Mono>): deploy afterwards.
          {isPreview && ' This preview has its own .env, seeded from its parent.'}
        </p>
        {paste !== null && (
          <div className="space-y-2 border-b border-stone-200 p-4 dark:border-stone-800">
            <textarea
              className={cx(inputClass, 'h-32 font-mono text-xs')}
              placeholder={'APP_ENV=staging\nMAIL_HOST=smtp.example.com'}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              aria-label="Paste KEY=value lines"
            />
            <Button
              onClick={() => {
                setRows((rs) => applyPasted(rs, parsePasted(paste)));
                setPaste(null);
                setSaved(false);
              }}
            >
              Add {parsePasted(paste).length} variable(s)
            </Button>
          </div>
        )}
        <div className="divide-y divide-stone-100 dark:divide-stone-800">
          {rows.length === 0 && <p className="p-4 text-sm text-stone-500">No variables yet.</p>}
          {rows.map((r, i) => {
            const err = rowError(r, rows);
            const shown = r.draft ?? (r.masked ? (revealed[r.key] ?? '') : (r.original ?? ''));
            const changed = r.isNew || r.deleted || (r.draft !== null && r.draft !== r.original);
            return (
              <div key={i} className={cx('grid grid-cols-1 gap-2 px-4 py-2 sm:grid-cols-[16rem_1fr_auto]', r.deleted && 'opacity-50', changed && 'bg-amber-50/60 dark:bg-amber-950/20')}>
                <div>
                  {r.isNew ? (
                    <input className={cx(inputClass, 'font-mono')} value={r.key} placeholder="KEY" aria-label="Variable name" onChange={(e) => update(i, { key: e.target.value.toUpperCase() })} />
                  ) : (
                    <div className="flex items-center gap-2 py-1.5">
                      <Mono className={r.deleted ? 'line-through' : ''}>{r.key}</Mono>
                      {r.managed && <Badge tone="neutral">set by ddeploy</Badge>}
                    </div>
                  )}
                  {err && <p className="mt-1 text-xs text-red-700 dark:text-red-400">{err}</p>}
                </div>
                <div>
                  <input
                    className={cx(inputClass, 'font-mono')}
                    value={shown}
                    disabled={r.deleted}
                    aria-label={`Value of ${r.key || 'new variable'}`}
                    placeholder={r.masked && revealed[r.key] === undefined && r.draft === null ? `•••••••• (${r.length} characters — reveal or type a new value)` : ''}
                    type={r.masked && revealed[r.key] === undefined && r.draft === null ? 'password' : 'text'}
                    onChange={(e) => update(i, { draft: e.target.value })}
                  />
                  {r.managed && r.draft !== null && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">ddeploy writes this from the site's real database grant: changing it here doesn't change the database.</p>
                  )}
                  {!r.managed && needsQuotes(shown) && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Contains spaces: wrap it in quotes, or most .env loaders will refuse the file.</p>}
                  {r.isNew && SECRET_KEY.test(r.key) && <p className="mt-1 text-xs text-stone-500">Will be masked here after saving.</p>}
                </div>
                <div className="flex items-start gap-1">
                  {r.masked && !r.deleted && (
                    <Button variant="ghost" busy={revealing === r.key} onClick={() => void reveal(r.key)} aria-label={revealed[r.key] !== undefined ? `Hide ${r.key}` : `Reveal ${r.key}`} title="Reveal (recorded in the activity log)">
                      {revealed[r.key] !== undefined ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                  )}
                  {changed && !r.isNew ? (
                    <Button variant="ghost" onClick={() => update(i, { draft: null, deleted: false })} aria-label={`Undo changes to ${r.key}`} title="Undo">
                      <Undo2 className="size-4" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => (r.isNew ? setRows((rs) => rs.filter((_, j) => j !== i)) : update(i, { deleted: true }))}
                      aria-label={`Remove ${r.key || 'new variable'}`}
                      title="Remove"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-stone-200 px-4 py-3 dark:border-stone-800">
          <Button variant="primary" disabled={!dirty || invalid} busy={apply.isPending} onClick={save}>
            Save {dirty ? `${Object.keys(change.set).length + change.unset.length} change(s)` : ''}
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => env.data && setRows(rowsFrom(env.data.entries))}>
              Discard
            </Button>
          )}
          {saved && !dirty && (
            <span className="flex items-center gap-3 text-sm text-emerald-700 dark:text-emerald-400">
              Saved — live now. <DeployNowButton server={server} name={name} label="Deploy to clear cached config" />
            </span>
          )}
          {apply.error && <InlineError error={apply.error} className="text-sm text-red-700" />}
        </div>
      </Card>
    </div>
  );
}
