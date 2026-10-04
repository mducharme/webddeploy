import { useNavigate } from '@tanstack/react-router';
import { Link } from '@tanstack/react-router';
import type { Preview } from '@webddeploy/shared';
import { ExternalLink, GitBranchPlus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Commit, RunTable } from '../components/RunTable.tsx';
import { Badge, Button, Card, ConfirmButton, Empty, ErrorBox, Field, Spinner, Td, Th, inputClass, InlineError } from '../components/ui.tsx';
import { useBranches, useInfo, usePreviewRun, usePreviews } from '../lib/api.ts';
import { relativeTime } from '../lib/format.ts';
import { Can, useCan } from '../lib/role.tsx';

const MODE_HELP = {
  shared: "Uses the site's database and uploads. Content entered in the preview is the site's content; migrations on the branch run against it.",
  isolated: "Its own database and uploads, copied from the site once at creation. Safe for destructive migrations; what's entered in it goes away with it.",
} as const;

export function PreviewsTab({ server, project, repo }: { server: string; project: string; repo?: string | null }) {
  const previews = usePreviews(server, project);
  if (previews.isPending) return <Spinner />;
  if (previews.error) return <ErrorBox error={previews.error} title="Couldn't read the previews" />;
  const { active, history } = previews.data;
  return (
    <div className="space-y-4">
      <Can role="admin"><NewPreview server={server} project={project} taken={active.map((p) => p.branch)} /></Can>
      <Card title={`Active previews (${active.length})`}>
        {active.length === 0 ? (
          <Empty>No previews. Create one above, or push to a branch matching the site's preview branches.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem]">
              <thead className="border-b border-stone-200 dark:border-stone-800">
                <tr><Th>Branch</Th><Th>URL</Th><Th>Data</Th><Th>Live</Th><Th className="text-right">Actions</Th></tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {active.map((p) => <PreviewRow key={p.name} server={server} project={project} preview={p} repo={repo} />)}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Preview history">
        <RunTable runs={history} server={server} repo={repo} showSite empty="No preview activity recorded yet." />
      </Card>
    </div>
  );
}

function NewPreview({ server, project, taken }: { server: string; project: string; taken: string[] }) {
  const branches = useBranches(server, project);
  const info = useInfo(server);
  const create = usePreviewRun(server, 'create');
  const navigate = useNavigate();
  const [branch, setBranch] = useState('');
  const [mode, setMode] = useState<'' | 'shared' | 'isolated'>('');
  const [seed, setSeed] = useState(true);
  const [auth, setAuth] = useState<'on' | 'off'>('on');
  const serverMode = (info.data?.preview_db_mode === 'isolated' ? 'isolated' : 'shared') as 'shared' | 'isolated';
  const effective = mode || serverMode;
  const candidates = (branches.data?.branches ?? []).filter((b) => !taken.includes(b) && b !== branches.data?.default_branch);

  return (
    <Card title={<span className="flex items-center gap-2"><GitBranchPlus className="size-4" aria-hidden /> New preview</span>}>
      <div className="grid gap-4 p-4 md:grid-cols-[1fr_1fr]">
        <Field label="Branch" hint={branches.isPending ? 'Listing the repository’s branches…' : `${candidates.length} branch(es) without a preview`}>
          <select className={inputClass} value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch">
            <option value="">Choose a branch…</option>
            {candidates.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
        <Field label="Basic auth" hint="On by default for previews, so unfinished work isn't public.">
          <select className={inputClass} value={auth} onChange={(e) => setAuth(e.target.value as 'on' | 'off')} aria-label="Basic auth">
            <option value="on">on</option>
            <option value="off">off</option>
          </select>
        </Field>
        <fieldset className="md:col-span-2">
          <legend className="text-sm font-medium">Data</legend>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {(['shared', 'isolated'] as const).map((m) => (
              <label key={m} className={`flex cursor-pointer gap-3 rounded-md border p-3 text-sm ${effective === m ? 'border-teal-600 bg-teal-50/50 dark:bg-teal-950/30' : 'border-stone-200 dark:border-stone-700'}`}>
                <input type="radio" name="mode" checked={effective === m} onChange={() => setMode(m)} className="mt-1" aria-label={`${m} data`} />
                <span>
                  <span className="font-medium capitalize">{m}</span>
                  {m === serverMode && <span className="ml-2 text-xs text-stone-500">server default</span>}
                  <span className="mt-1 block text-stone-600 dark:text-stone-400">{MODE_HELP[m]}</span>
                </span>
              </label>
            ))}
          </div>
          {effective === 'isolated' && (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={seed} onChange={(e) => setSeed(e.target.checked)} />
              Copy the site's database and uploads into it (otherwise it starts empty)
            </label>
          )}
        </fieldset>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-stone-200 px-4 py-3 dark:border-stone-800">
        <Button
          variant="primary"
          disabled={!branch}
          busy={create.isPending}
          onClick={() =>
            create.mutate(
              { project, body: { branch, mode: mode || null, seed, auth: auth === 'on' } },
              { onSuccess: ({ run_id }) => void navigate({ to: '/s/$server/runs/$id', params: { server, id: run_id } }) },
            )
          }
        >
          Create preview{branch ? ` of ${branch}` : ''}
        </Button>
        {create.error && <InlineError error={create.error} className="text-sm text-red-700" />}
      </div>
    </Card>
  );
}

function PreviewRow({ server, project, preview: p, repo }: { server: string; project: string; preview: Preview; repo?: string | null }) {
  return (
    <tr>
      <Td>
        <Link to="/s/$server/sites/$name" params={{ server, name: p.name }} className="font-medium hover:underline">{p.branch}</Link>
        <div className="text-xs text-stone-500">{p.name}</div>
      </Td>
      <Td>
        <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-teal-700 hover:underline dark:text-teal-400">
          {p.url.replace('https://', '')} <ExternalLink className="size-3" aria-hidden />
        </a>
      </Td>
      <Td><Badge tone="neutral">{p.mode}</Badge></Td>
      <Td>
        <Commit sha={p.sha} repo={repo} subject={p.subject} />
        {p.committed_at && <div className="text-xs text-stone-500">committed {relativeTime(p.committed_at)}</div>}
      </Td>
      <Td className="text-right">
        <PreviewActions server={server} project={project} branch={p.branch} mode={p.mode} />
      </Td>
    </tr>
  );
}

/** Redeploy / remove one preview; used in the list and on the preview's own page. */
export function PreviewActions({ server, project, branch, mode }: { server: string; project: string; branch: string; mode: string }) {
  const deploy = usePreviewRun(server, 'deploy');
  const remove = usePreviewRun(server, 'remove');
  const navigate = useNavigate();
  const go = ({ run_id }: { run_id: string }) => void navigate({ to: '/s/$server/runs/$id', params: { server, id: run_id } });
  if (!useCan('admin')) return null;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="inline-flex flex-wrap justify-end gap-2">
        <ConfirmButton label="Redeploy" busyLabel="Starting…" confirmLabel={`Redeploy ${branch}`} icon={<RefreshCw className="size-4" aria-hidden />} busy={deploy.isPending} onConfirm={() => deploy.mutateAsync({ project, body: { branch } }, { onSuccess: go })} />
        <ConfirmButton
          label="Remove" busyLabel="Removing…"
          confirmLabel={mode === 'isolated' ? 'Remove it and its database' : 'Remove preview'}
          icon={<Trash2 className="size-4" aria-hidden />}
          busy={remove.isPending}
          onConfirm={() => remove.mutateAsync({ project, body: { branch } }, { onSuccess: go })}
        />
      </span>
      {(deploy.error ?? remove.error) && <span className="max-w-xs text-xs text-red-700">{(deploy.error ?? remove.error)!.message}</span>}
    </span>
  );
}
