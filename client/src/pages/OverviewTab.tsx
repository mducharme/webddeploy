import { Link } from '@tanstack/react-router';
import { CHANGE_KINDS, type Run, type SiteDetailResponse } from '@webddeploy/shared';
import { CheckCircle2, Circle, X } from 'lucide-react';
import { useState } from 'react';
import { Checks } from '../components/Checks.tsx';
import { Commit, Trigger } from '../components/RunTable.tsx';
import { Card, ErrorBox, PhaseBadge, Spinner, StatusDot, Mono, InlineError } from '../components/ui.tsx';
import { useDbInfo, useDoctor, useEnv, useInfo, useSiteRuns, useUploads } from '../lib/api.ts';
import { duration, kindLabel, relativeTime } from '../lib/format.ts';
import type { SiteTab } from './Site.tsx';
import { RollbackButton } from './siteShared.tsx';
import { useCan } from '../lib/role.tsx';

const isCodeRun = (r: Run) => ['deploy', 'rollback', 'provision'].includes(r.kind);

export function OverviewTab({ server, detail }: { server: string; detail: SiteDetailResponse }) {
  const name = detail.site.name;
  const doctor = useDoctor(server, name);
  const runs = useSiteRuns(server, name);
  const health = doctor.data?.sites.find((s) => s.name === name);
  const http = health?.checks.find((c) => c.check === 'http');
  const problems = health?.checks.filter((c) => c.status === 'warn' || c.status === 'fail') ?? [];
  const codeRuns = runs.data?.runs.filter(isCodeRun) ?? [];
  const last = runs.data?.runs.find((r) => !CHANGE_KINDS.has(r.kind));
  const lastGood = codeRuns.find((r) => r.phase === 'succeeded' && r.to_sha && r.to_sha !== detail.site.sha);
  const isAdmin = useCan('admin');

  return (
    <div className="space-y-4">
      {isAdmin && runs.data && runs.data.runs.length <= 4 && !detail.site.preview && <NextSteps server={server} detail={detail} />}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-stone-500">Health</p>
          {doctor.isPending ? (
            <p className="mt-2 text-sm text-stone-500">Running checks…</p>
          ) : doctor.error ? (
            <InlineError error={doctor.error} className="mt-2 text-sm text-red-700" />
          ) : (
            <>
              <p className="mt-2 flex items-center gap-2 text-lg font-semibold">
                <StatusDot status={health?.worst ?? 'off'} />
                {{ ok: 'Healthy', warn: 'Needs a look', fail: 'Failing', off: 'Unknown' }[health?.worst ?? 'off']}
              </p>
              <p className="mt-1 text-sm text-stone-500">{http ? http.detail : 'no HTTP check (update ddeploy)'}</p>
            </>
          )}
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-stone-500">Live</p>
          <p className="mt-2 text-sm text-stone-500">{detail.site.branch ?? 'detached'}</p>
          <Commit sha={detail.site.sha} repo={detail.site.repo} subject={detail.site.subject} />
          <p className="mt-1 text-xs text-stone-500" data-testid="stack">
            PHP {detail.site.php ?? '?'}
            {detail.site.node && <> · Node {detail.site.node}{detail.site.build && ' (build)'}</>}
            {detail.site.docroot && <> · docroot <Mono>{detail.site.docroot}</Mono></>}
          </p>
          {detail.deploy_branch && detail.deploy_branch !== detail.site.branch && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Switches to {detail.deploy_branch} on the next deploy.</p>
          )}
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-stone-500">Last run</p>
          {runs.isPending ? (
            <p className="mt-2 text-sm text-stone-500">Loading…</p>
          ) : last ? (
            <div className="mt-2 space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <PhaseBadge phase={last.phase} />
                <Link to="/s/$server/runs/$id" params={{ server, id: last.run_id }} className="hover:underline">
                  {kindLabel(last.kind)} {relativeTime(last.started_at ?? last.finished_at)}
                </Link>
              </div>
              <p className="text-stone-500">by <Trigger trigger={last.trigger} author={last.author} />{last.duration_s != null && ` · ${duration(last.duration_s)}`}</p>
              {last.error && <p className="text-xs text-red-700 dark:text-red-400">{last.error}</p>}
            </div>
          ) : (
            <p className="mt-2 text-sm text-stone-500">Nothing recorded yet.</p>
          )}
        </Card>
      </div>

      {isAdmin && last?.phase === 'failed' && isCodeRun(last) && lastGood?.to_sha && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <span>
            The last {kindLabel(last.kind).toLowerCase()} failed{last.kind === 'deploy' ? ' — the previous release is still live' : ''}. Fix the
            cause and deploy again, or roll back to the last good deploy ({relativeTime(lastGood.finished_at)}).
          </span>
          <RollbackButton server={server} name={name} sha={lastGood.to_sha} label="Roll back" />
        </div>
      )}

      {problems.length > 0 && (
        <Card title="Needs attention">
          <Checks checks={problems} />
        </Card>
      )}
    </div>
  );
}

function NextSteps({ server, detail }: { server: string; detail: SiteDetailResponse }) {
  const name = detail.site.name;
  const storageKey = `wdd:next-steps-dismissed:${server}:${name}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  });
  const env = useEnv(server, name);
  const db = useDbInfo(server, name, !dismissed);
  const info = useInfo(server);
  const uploads = useUploads(server, name);
  if (dismissed) return null;

  const hasEnv = env.data?.entries.some((e) => !e.managed) ?? false;
  const hasDb = (db.data?.table_count ?? 0) > 0;
  const hasDomain = (detail.config?.custom_domains.length ?? 0) > 0;
  const hasFiles = uploads.data?.dirs.some((d) => (d.bytes ?? 0) > 0) ?? false;
  const steps: Array<{ done: boolean; title: string; text: string; tab?: SiteTab }> = [
    { done: hasEnv, title: 'Set environment variables', text: 'App keys, mail and API credentials — the .env every release shares.', tab: 'environment' },
    { done: hasDb, title: 'Import the database', text: 'Upload a dump (ddev export-db works). A snapshot is taken first.', tab: 'database' },
    { done: hasFiles, title: 'Upload the files', text: `Drop the uploads folder (or a .zip/.tar.gz) into ${detail.config?.upload_dirs.join(', ') || 'its upload folder'}.`, tab: 'files' },
    { done: hasDomain, title: 'Add a custom domain (optional)', text: 'Point DNS at this server first, then add it in Settings and deploy.', tab: 'settings' },
    {
      done: false,
      title: 'Deploy on every push',
      text: info.data?.features.webhook ? 'Add the server\'s webhook to the repository (README "Deploy on git push").' : 'The git-push webhook is off on this server (WEBHOOK_ENABLED).',
    },
  ];

  return (
    <Card
      title="Next steps for a new site"
      actions={
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
            try {
              localStorage.setItem(storageKey, '1');
            } catch {
              /* storage blocked: dismissed for this visit only */
            }
          }}
          className="text-stone-400 hover:text-stone-700"
          aria-label="Dismiss next steps"
        >
          <X className="size-4" />
        </button>
      }
    >
      {env.error && <ErrorBox error={env.error} />}
      <ol className="divide-y divide-stone-100 dark:divide-stone-800">
        {steps.map((s) => (
          <li key={s.title} className="flex items-start gap-3 px-4 py-2.5 text-sm">
            {s.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="done" /> : <Circle className="mt-0.5 size-4 shrink-0 text-stone-300" aria-label="to do" />}
            <div className="min-w-0 flex-1">
              <p className={s.done ? 'text-stone-500 line-through' : 'font-medium'}>{s.title}</p>
              <p className="text-stone-500">{s.text}</p>
            </div>
            {s.tab && !s.done && (
              <Link to="/s/$server/sites/$name" params={{ server, name }} search={{ tab: s.tab }} className="shrink-0 text-teal-700 hover:underline dark:text-teal-400">
                Open
              </Link>
            )}
          </li>
        ))}
      </ol>
      {(env.isPending || db.isPending) && <Spinner />}
    </Card>
  );
}
