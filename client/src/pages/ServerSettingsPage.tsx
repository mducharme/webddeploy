import { useParams } from '@tanstack/react-router';
import { APPLY_LABELS, SERVER_SETTINGS, type ServerConfigResponse, type ServerSettingDef } from '@webddeploy/shared';
import { ChangeSummary, type Change } from '../components/ChangeSummary.tsx';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, ErrorBox, Field, Mono, Spinner, cx, inputClass, InlineError } from '../components/ui.tsx';
import { useServerConfig, useSetServerConfig } from '../lib/api.ts';

/** Fields changed from what the server reports; secrets only when something was typed. */
export function configChanges(config: ServerConfigResponse, drafts: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(drafts)) {
    const current = config.settings.find((s) => s.key === key);
    if (!current) continue;
    if (current.secret ? value !== '' || drafts[`${key}:clear`] === '1' : value.trim() !== current.value) out[key] = value.trim();
  }
  for (const [k, v] of Object.entries(drafts)) if (k.endsWith(':clear') && v === '1') out[k.slice(0, -6)] = '';
  return out;
}

/** The changes as a list to review, and when they take effect. */
export function serverSettingChanges(config: ServerConfigResponse, changes: Record<string, string>): { list: Change[]; note: string } {
  const list: Change[] = [];
  const applies = new Set<string>();
  for (const [key, to] of Object.entries(changes)) {
    const def = SERVER_SETTINGS.find((d) => d.key === key);
    const current = config.settings.find((s) => s.key === key);
    if (current) applies.add(APPLY_LABELS[current.apply]);
    list.push({ label: def?.label ?? key, kind: to === '' && current?.secret ? 'removed' : 'changed', from: current?.secret ? (current.is_set ? 'x' : '') : current?.value, to, secret: current?.secret });
  }
  return { list, note: `applies ${[...applies].join('; ')}` };
}

export function ServerSettingsPage() {
  const { server } = useParams({ from: '/s/$server/server-settings' });
  const config = useServerConfig(server);
  const save = useSetServerConfig(server);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => setDrafts({}), [config.data]);

  const changes = useMemo(() => (config.data ? configChanges(config.data, drafts) : {}), [config.data, drafts]);
  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(changes)) {
      const def = SERVER_SETTINGS.find((s) => s.key === k);
      if (def?.pattern && !def.pattern.test(v)) out[k] = `invalid ${def.label.toLowerCase()}`;
    }
    return out;
  }, [changes]);

  if (config.isPending) return <Spinner label="Reading the server's settings…" />;
  if (config.error) return <ErrorBox error={config.error} title="Couldn't read the server settings" />;
  const c = config.data;
  const groups = [...new Set(SERVER_SETTINGS.map((s) => s.group))];
  const n = Object.keys(changes).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Server settings</h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          From <Mono>{c.file}</Mono>. Every change is checked by ddeploy, backed up first, and applied as it says below each field.
        </p>
      </div>
      {groups.map((g) => (
        <Card key={g} title={g}>
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            {SERVER_SETTINGS.filter((d) => d.group === g).map((def) => (
              <SettingField key={def.key} def={def} config={c} drafts={drafts} setDrafts={(d) => { setSaved(null); setDrafts(d); }} error={errors[def.key]} />
            ))}
          </div>
        </Card>
      ))}
      <Card title="Fixed here (set on the server)">
        <dl className="grid gap-x-6 gap-y-1 p-4 text-sm sm:grid-cols-2">
          {Object.entries(c.readonly).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-stone-100 py-1 dark:border-stone-800"><dt className="text-stone-500"><Mono>{k}</Mono></dt><dd className="truncate">{v || '—'}</dd></div>
          ))}
        </dl>
      </Card>
      {(n > 0 || saved || save.error) && (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-stone-800 dark:bg-stone-900/95">
          {n > 0 && (
            <div className="w-full">
              <ChangeSummary changes={serverSettingChanges(c, changes).list} note={serverSettingChanges(c, changes).note} />
            </div>
          )}
          <Button
            variant="primary"
            disabled={n === 0 || Object.keys(errors).length > 0}
            busy={save.isPending}
            onClick={() => save.mutate(changes, { onSuccess: () => setSaved(`Saved ${n} setting(s).`) })}
          >
            Save {n} change(s)
          </Button>
          {n > 0 && <Button variant="ghost" onClick={() => setDrafts({})}>Discard</Button>}
          {saved && n === 0 && <span className="text-sm text-emerald-700 dark:text-emerald-400">{saved}</span>}
          {save.error && <InlineError error={save.error} className="text-sm text-red-700" />}
        </div>
      )}
    </div>
  );
}

function SettingField({ def, config, drafts, setDrafts, error }: { def: ServerSettingDef; config: ServerConfigResponse; drafts: Record<string, string>; setDrafts: (d: Record<string, string>) => void; error?: string }) {
  const current = config.settings.find((s) => s.key === def.key);
  if (!current) return null;
  const value = drafts[def.key] ?? (def.kind === 'secret' ? '' : current.value);
  const set = (v: string) => setDrafts({ ...drafts, [def.key]: v });
  const disabledBackups = (def.key === 'BACKUP_ENABLED' || def.key === 'DB_BACKUP_ENABLED') && !config.backups_configured && current.value !== 'true';
  const label = (
    <span className="flex flex-wrap items-center gap-2">
      {def.label}
      {current.explicit ? null : <Badge tone="neutral">default</Badge>}
    </span>
  );
  const hint = (
    <>
      {def.help} <span className="text-stone-400">Applies {APPLY_LABELS[current.apply]}.</span>
      {disabledBackups && <span className="block text-amber-700">Object storage isn't set up on the server yet (ddeploy configure backups).</span>}
    </>
  );
  return (
    <Field label={label} hint={hint} error={error}>
      {def.kind === 'bool' ? (
        <select className={inputClass} value={value} disabled={disabledBackups} onChange={(e) => set(e.target.value)} aria-label={def.label}>
          <option value="true">on</option>
          <option value="false">off</option>
        </select>
      ) : def.kind === 'select' ? (
        <select className={inputClass} value={value} onChange={(e) => set(e.target.value)} aria-label={def.label}>
          {def.options!.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : def.kind === 'secret' ? (
        <div className="flex gap-2">
          <input
            className={cx(inputClass, 'font-mono')}
            type="password"
            autoComplete="off"
            value={value}
            placeholder={current.is_set ? '•••••••• (set — type to replace)' : def.placeholder}
            onChange={(e) => set(e.target.value)}
            aria-label={def.label}
          />
          {current.is_set && (
            <Button variant="ghost" onClick={() => setDrafts({ ...drafts, [def.key]: '', [`${def.key}:clear`]: '1' })}>Turn off</Button>
          )}
        </div>
      ) : (
        <input className={cx(inputClass, 'font-mono')} value={value} placeholder={def.placeholder} onChange={(e) => set(e.target.value)} aria-label={def.label} />
      )}
    </Field>
  );
}
