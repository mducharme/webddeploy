import { SETTINGS, type SettingDef, type SettingsRequest, type SiteDetailResponse } from '@webddeploy/shared';
import { RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Field, Mono, cx, inputClass, InlineError } from '../components/ui.tsx';
import { useApplySettings, useBranches } from '../lib/api.ts';
import { DeployNowButton } from './siteShared.tsx';
import { useCan } from '../lib/role.tsx';

type Value = string | string[];

const toText = (v: Value | undefined) => (Array.isArray(v) ? v.join(' ') : (v ?? ''));
const words = (s: string) => s.split(/[\s,]+/).filter(Boolean);

/** Builds the PUT body from the edited fields: changed values are set, "reset" keys unset. */
export function settingsChange(
  defs: readonly SettingDef[],
  effective: Record<string, Value>,
  drafts: Record<string, string>,
  resets: ReadonlySet<string>,
  branch: string | null | undefined,
): SettingsRequest {
  const set: Record<string, Value> = {};
  for (const def of defs) {
    const d = drafts[def.key];
    if (d === undefined || resets.has(def.key)) continue;
    if (def.kind === 'list') {
      if (words(d).join(' ') !== toText(effective[def.key])) set[def.key] = words(d);
    } else if (d.trim() !== toText(effective[def.key])) set[def.key] = d.trim();
  }
  return { set, unset: [...resets], ...(branch !== undefined ? { branch } : {}) };
}

export function SettingsTab({ server, detail }: { server: string; detail: SiteDetailResponse }) {
  const name = detail.site.name;
  const effective = (detail.config?.settings ?? {}) as Record<string, Value>;
  const overrides = detail.overrides ?? {};
  const apply = useApplySettings(server, name);
  const branches = useBranches(server, name, !detail.site.preview);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [resets, setResets] = useState<Set<string>>(new Set());
  const [branch, setBranch] = useState<string | null | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const canEdit = useCan('admin');

  useEffect(() => {
    setDrafts({});
    setResets(new Set());
    setBranch(undefined);
  }, [detail]);

  const change = useMemo(() => settingsChange(SETTINGS, effective, drafts, resets, branch), [effective, drafts, resets, branch]);
  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const def of SETTINGS) {
      const d = drafts[def.key];
      if (d === undefined || !def.pattern) continue;
      const values = def.kind === 'list' ? words(d) : d.trim() ? [d.trim()] : [];
      if (values.some((v) => !def.pattern!.test(v))) out[def.key] = `invalid ${def.label.toLowerCase()}`;
    }
    return out;
  }, [drafts]);
  const dirty = Object.keys(change.set ?? {}).length > 0 || (change.unset?.length ?? 0) > 0 || change.branch !== undefined;

  if (!detail.config?.settings) {
    return <Card className="p-4 text-sm text-stone-500">This ddeploy version doesn't report site settings yet — update ddeploy on the server.</Card>;
  }

  const groups = [...new Set(SETTINGS.map((s) => s.group))];
  const tracked = branch !== undefined ? branch : detail.deploy_branch;

  return (
    <div className="space-y-4">
      {!canEdit && <p className="rounded-md bg-stone-100 p-3 text-sm text-stone-600 dark:bg-stone-800 dark:text-stone-300">Read-only: changing settings needs the admin role.</p>}
      <p className="text-sm text-stone-600 dark:text-stone-400">
        Changes are operator overrides on the server — they win over the repository's <Mono>.ddeploy/config.yaml</Mono> and{' '}
        <Mono>.ddev/config.yaml</Mono>, and apply on the next deploy.
      </p>
      {!detail.site.preview && (
        <Card title="Branch">
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Deployed branch" hint="The next deploy switches to it.">
              <select disabled={!canEdit} className={inputClass} value={tracked ?? ''} onChange={(e) => { setSaved(false); setBranch(e.target.value || null); }} aria-label="Deployed branch">
                <option value="">repository default{branches.data?.default_branch ? ` (${branches.data.default_branch})` : ''}</option>
                {(branches.data?.branches ?? (tracked ? [tracked] : [])).map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </Field>
            <div className="text-sm text-stone-500 sm:pt-6">Currently deployed: <strong>{detail.site.branch ?? 'detached'}</strong></div>
          </div>
        </Card>
      )}
      {groups.map((group) => (
        <Card key={group} title={group}>
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            {SETTINGS.filter((s) => s.group === group).map((def) => {
              const overridden = def.key in overrides && !resets.has(def.key);
              const value = resets.has(def.key) ? toText(effective[def.key]) : (drafts[def.key] ?? toText(effective[def.key]));
              const label = (
                <span className="flex items-center gap-2">
                  {def.label}
                  {overridden && <Badge tone="warn">override</Badge>}
                  {resets.has(def.key) && <Badge tone="neutral">reset on save</Badge>}
                </span>
              );
              const set = (v: string) => {
                setSaved(false);
                setResets((r) => { const n = new Set(r); n.delete(def.key); return n; });
                setDrafts((d) => ({ ...d, [def.key]: v }));
              };
              return (
                <div key={def.key} className="relative">
                  <Field label={label} hint={def.help} error={errors[def.key]}>
                    {def.kind === 'bool' ? (
                      <select disabled={!canEdit} className={inputClass} value={value} onChange={(e) => set(e.target.value)} aria-label={def.label}>
                        <option value="true">on</option>
                        <option value="false">off</option>
                      </select>
                    ) : (
                      <input disabled={!canEdit} className={cx(inputClass, def.kind === 'list' && 'font-mono')} value={value} placeholder={def.placeholder} onChange={(e) => set(e.target.value)} aria-label={def.label} />
                    )}
                  </Field>
                  {overridden && canEdit && (
                    <button
                      type="button"
                      className="absolute right-0 top-0 inline-flex items-center gap-1 text-xs text-stone-500 hover:text-teal-700"
                      onClick={() => {
                        setSaved(false);
                        setResets((r) => new Set(r).add(def.key));
                        setDrafts(({ [def.key]: _, ...rest }) => rest);
                      }}
                      title="Drop the override: back to what the repository (or the server default) says"
                    >
                      <RotateCcw className="size-3" aria-hidden /> reset
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ))}
      {(dirty || saved || apply.error) && <div className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-stone-800 dark:bg-stone-900/95">
        <Button variant="primary" disabled={!dirty || Object.keys(errors).length > 0} busy={apply.isPending} onClick={() => apply.mutate(change, { onSuccess: () => setSaved(true) })}>
          Save settings
        </Button>
        {dirty && <Button variant="ghost" onClick={() => { setDrafts({}); setResets(new Set()); setBranch(undefined); }}>Discard</Button>}
        {saved && !dirty && (
          <span className="flex items-center gap-3 text-sm text-emerald-700 dark:text-emerald-400">
            Saved — applies on the next deploy. {!detail.site.preview && <DeployNowButton server={server} name={name} label="Deploy now" />}
          </span>
        )}
        {apply.error && <InlineError error={apply.error} className="text-sm text-red-700" />}
      </div>}
    </div>
  );
}
