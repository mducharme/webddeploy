import { useNavigate, useParams } from '@tanstack/react-router';
import { patterns, provisionCliCommand, provisionRequest, type InspectRepoResponse, type ProvisionRequest } from '@webddeploy/shared';
import { AlertTriangle, CheckCircle2, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Card, ErrorBox, Field, Mono, inputClass } from '../components/ui.tsx';
import { ApiError, useFreshSites, useInfo, useInspectRepo, useProvision } from '../lib/api.ts';

export interface ProvisionForm {
  name: string;
  repo_url: string;
  branch: string;
  php: string;
  docroot: string;
  db: string;
  hostnames: string;
  custom_domains: string;
  upload_dirs: string;
  auth: '' | 'on' | 'off';
  node: string;
  build: '' | 'on' | 'off';
}

export const emptyForm: ProvisionForm = {
  name: '', repo_url: '', branch: '', php: '', docroot: '', db: '',
  hostnames: '', custom_domains: '', upload_dirs: '', auth: '', node: '', build: '',
};

const words = (s: string) => s.split(/[\s,]+/).filter(Boolean);
const tri = (v: '' | 'on' | 'off') => (v === 'on' ? true : v === 'off' ? false : null);

export function toRequest(f: ProvisionForm): ProvisionRequest {
  return {
    name: f.name,
    repo_url: f.repo_url,
    branch: f.branch || null,
    php: f.php || null,
    docroot: f.docroot || null,
    db: f.db || null,
    hostnames: words(f.hostnames),
    custom_domains: words(f.custom_domains),
    upload_dirs: words(f.upload_dirs),
    auth: tri(f.auth),
    node: f.node || null,
    build: tri(f.build),
  };
}

/** Problems that would make ddeploy refuse or fail this provision, by field. */
export function validate(f: ProvisionForm, inspect: InspectRepoResponse | null, existing: readonly string[]): Record<string, string> {
  const errors: Record<string, string> = {};
  const parsed = provisionRequest.safeParse(toRequest(f));
  if (!parsed.success) for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;
  if (existing.includes(f.name)) errors.name = `'${f.name}' already exists`;
  const ddevName = inspect?.detected?.ddev?.name;
  // ddeploy refuses a .ddev/config.yaml whose name: isn't the site name.
  if (ddevName && f.name && ddevName !== f.name) errors.name = `the repository's .ddev/config.yaml is named '${ddevName}' — the site must have the same name`;
  if (inspect?.requires?.php && !f.php) errors.php = 'no .ddev/config.yaml in the repository: pick a PHP version';
  return errors;
}

export function Provision() {
  const { server } = useParams({ from: '/s/$server/provision' });
  const navigate = useNavigate();
  const info = useInfo(server);
  const sites = useFreshSites(server);
  const inspect = useInspectRepo(server);
  const provision = useProvision(server);
  const [f, setF] = useState<ProvisionForm>(emptyForm);
  const [inspected, setInspected] = useState<InspectRepoResponse | null>(null);
  const set = <K extends keyof ProvisionForm>(k: K, v: ProvisionForm[K]) => setF((x) => ({ ...x, [k]: v }));

  const existing = useMemo(() => sites.data?.sites.map((s) => s.name) ?? [], [sites.data]);
  const errors = validate(f, inspected, existing);
  const ready = inspected?.reachable && !inspected.error && Object.keys(errors).length === 0;
  const parsed = provisionRequest.safeParse(toRequest(f));
  const phpVersions = info.data ? [...new Set([...info.data.php.installed, ...info.data.php.baseline])].sort() : [];

  const runInspect = () => {
    setInspected(null);
    inspect.mutate(
      { repo_url: f.repo_url.trim(), branch: f.branch.trim() || null },
      {
        onSuccess: (r) => {
          setInspected(r);
          const ddev = r.detected?.ddev;
          setF((x) => ({
            ...x,
            name: x.name || ddev?.name || x.name,
            branch: x.branch || (r.branch && r.branch !== r.default_branch ? r.branch : ''),
            php: r.requires?.php ? x.php || info.data?.php.default || '' : x.php,
            docroot: r.requires?.php ? x.docroot || r.detected?.cms_docroot || '' : x.docroot,
          }));
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">New project</h1>

      <Card title="1. Repository">
        <div className="grid gap-4 p-4 sm:grid-cols-[1fr_12rem]">
          <Field label="Git URL" hint="Reached with the server's shared deploy key (GIT_DEPLOY_KEY)." error={f.repo_url && !patterns.repoUrl.test(f.repo_url.trim()) ? 'an ssh://, git@ or https:// URL' : null}>
            <input className={inputClass} value={f.repo_url} onChange={(e) => { set('repo_url', e.target.value); setInspected(null); }} placeholder="git@github.com:org/client-site.git" autoFocus />
          </Field>
          <Field label="Branch" hint="Empty: the repository's default.">
            {inspected?.branches?.length ? (
              <select className={inputClass} value={f.branch || inspected.default_branch || ''} onChange={(e) => { set('branch', e.target.value === inspected.default_branch ? '' : e.target.value); }}>
                {inspected.branches.map((b) => <option key={b} value={b}>{b}{b === inspected.default_branch ? ' (default)' : ''}</option>)}
              </select>
            ) : (
              <input className={inputClass} value={f.branch} onChange={(e) => set('branch', e.target.value)} placeholder="main" />
            )}
          </Field>
        </div>
        <div className="flex items-center gap-3 border-t border-stone-200 px-4 py-3 dark:border-stone-800">
          <Button onClick={runInspect} busy={inspect.isPending} disabled={!patterns.repoUrl.test(f.repo_url.trim())}>
            <Search className="size-4" aria-hidden /> Inspect repository
          </Button>
          {inspect.isPending && <span className="text-sm text-stone-500">Cloning a shallow copy to look at its config…</span>}
        </div>
        {inspect.error && <ErrorBox error={inspect.error} title="Couldn't inspect the repository" />}
        {inspected && <InspectSummary r={inspected} />}
      </Card>

      {inspected?.reachable && !inspected.error && (
        <Card title="2. Site">
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Site name" hint={info.data ? `https://${f.name || 'name'}.${info.data.base_domain}` : null} error={f.name ? errors.name : null}>
              <input className={inputClass} value={f.name} onChange={(e) => set('name', e.target.value.toLowerCase())} placeholder="client-site" />
            </Field>
            <Field label="PHP" hint={inspected.requires?.php ? 'Required: the repository has no .ddev/config.yaml.' : 'Empty: from .ddev/config.yaml.'} error={errors.php}>
              <select className={inputClass} value={f.php} onChange={(e) => set('php', e.target.value)}>
                <option value="">{inspected.requires?.php ? 'Choose…' : `from the repository (${inspected.detected?.ddev?.php_version ?? '?'})`}</option>
                {phpVersions.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
            {inspected.requires?.php && (
              <Field label="Docroot" hint="Relative to the repository root; empty for the root itself." error={errors.docroot}>
                <input className={inputClass} value={f.docroot} onChange={(e) => set('docroot', e.target.value)} placeholder="web" />
              </Field>
            )}
            <Field label="Database name" hint={`Empty: ${f.name || 'the site name'}.`} error={errors.db}>
              <input className={inputClass} value={f.db} onChange={(e) => set('db', e.target.value)} />
            </Field>
            <Field label="Extra hostnames" hint={info.data ? `Each becomes <name>.${info.data.base_domain}, on the wildcard certificate.` : null} error={errors.hostnames}>
              <input className={inputClass} value={f.hostnames} onChange={(e) => set('hostnames', e.target.value)} placeholder="alt-name" />
            </Field>
            <Field label="Custom domains" hint="DNS must already point at this server: the certificate is issued over HTTP-01 during provisioning." error={errors.custom_domains}>
              <input className={inputClass} value={f.custom_domains} onChange={(e) => set('custom_domains', e.target.value)} placeholder="www.client.com" />
            </Field>
            <Field label="Upload dirs" hint="Relative to the docroot, like DDEV's upload_dirs. Empty: from the repository." error={errors.upload_dirs}>
              <input className={inputClass} value={f.upload_dirs} onChange={(e) => set('upload_dirs', e.target.value)} placeholder="uploads ../private" />
            </Field>
            <Field label="Basic auth">
              <select className={inputClass} value={f.auth} onChange={(e) => set('auth', e.target.value as ProvisionForm['auth'])}>
                <option value="">server default ({info.data?.basic_auth_default ? 'on' : 'off'})</option>
                <option value="on">on</option>
                <option value="off">off</option>
              </select>
            </Field>
            <Field label="Node version" hint="Pins it as an operator override. Empty: .nvmrc / config / server default." error={errors.node}>
              <input className={inputClass} value={f.node} onChange={(e) => set('node', e.target.value)} placeholder={inspected.detected?.nvmrc ?? info.data?.node.default ?? '22'} />
            </Field>
            <Field label="Frontend build">
              <select className={inputClass} value={f.build} onChange={(e) => set('build', e.target.value as ProvisionForm['build'])}>
                <option value="">auto-detect</option>
                <option value="on">on</option>
                <option value="off">off</option>
              </select>
            </Field>
          </div>
        </Card>
      )}

      {inspected?.reachable && !inspected.error && (
        <Card title="3. Review">
          <div className="space-y-3 p-4">
            <p className="text-sm text-stone-600 dark:text-stone-400">Same as running this on the server:</p>
            <pre className="overflow-x-auto rounded-md bg-stone-950 p-3 font-mono text-xs text-stone-100">
              {parsed.success ? provisionCliCommand(parsed.data) : '— fix the fields above —'}
            </pre>
            {provision.error && (
              <ErrorBox
                error={provision.error instanceof ApiError && provision.error.issues.length ? provision.error.issues.map((i) => `${i.path}: ${i.message}`).join('; ') : provision.error}
                title="ddeploy refused"
              />
            )}
            <Button
              variant="primary"
              disabled={!ready}
              busy={provision.isPending}
              onClick={() =>
                provision.mutate(toRequest(f), { onSuccess: ({ run_id }) => void navigate({ to: '/s/$server/runs/$id', params: { server, id: run_id } }) })
              }
            >
              Provision {f.name || 'site'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function InspectSummary({ r }: { r: InspectRepoResponse }) {
  if (!r.reachable) {
    return (
      <div role="alert" className="flex gap-2 border-t border-stone-200 p-4 text-sm text-red-800 dark:border-stone-800 dark:text-red-300">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        <div>
          <p className="font-medium">The server can't reach this repository.</p>
          <p className="mt-1 text-stone-600 dark:text-stone-400">Is the deploy key's machine user a collaborator on it? <Mono>{r.error}</Mono></p>
        </div>
      </div>
    );
  }
  const d = r.detected;
  return (
    <div className="border-t border-stone-200 p-4 text-sm dark:border-stone-800">
      {r.error ? (
        <p className="flex items-center gap-2 text-red-800 dark:text-red-300"><AlertTriangle className="size-4" aria-hidden /> {r.error}</p>
      ) : (
        <p className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300"><CheckCircle2 className="size-4" aria-hidden /> Reachable — {r.branches?.length ?? 0} branches, using <strong>{r.branch}</strong>.</p>
      )}
      {d && (
        <ul className="mt-2 list-inside list-disc space-y-0.5 text-stone-600 dark:text-stone-400">
          <li>{d.ddev ? <>.ddev/config.yaml: name <Mono>{d.ddev.name}</Mono>, PHP {d.ddev.php_version ?? 'default'}, docroot <Mono>{d.ddev.docroot || '.'}</Mono></> : 'No .ddev/config.yaml — PHP version and docroot needed below.'}</li>
          {d.ddeploy_config && <li>.ddeploy/config.yaml present</li>}
          {d.cms && <li>Detected {d.cms}{d.cms_docroot ? ` (docroot ${d.cms_docroot})` : ''}</li>}
          {d.package_json && <li>package.json{d.nvmrc ? `, .nvmrc ${d.nvmrc}` : ''} — a frontend build is detected automatically</li>}
        </ul>
      )}
    </div>
  );
}
