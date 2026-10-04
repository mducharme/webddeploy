import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { isTerminal, type Commit as CommitT, hintFor } from '@webddeploy/shared';
import { Square } from 'lucide-react';
import { useEffect } from 'react';
import { LogView } from '../components/LogView.tsx';
import { Commit, Trigger } from '../components/RunTable.tsx';
import { Card, ConfirmButton, ErrorBox, Mono, PhaseBadge, Spinner } from '../components/ui.tsx';
import { keys, runStreamUrl, useCancelRun, useCommits, useRun, useSite } from '../lib/api.ts';
import { commitUrl, duration, kindLabel, relativeTime, shortSha } from '../lib/format.ts';
import { useOutputStream } from '../lib/stream.ts';
import { useCan } from '../lib/role.tsx';
import { DeployNowButton, RollbackButton } from './siteShared.tsx';

export function RunPage() {
  const { server, id } = useParams({ from: '/s/$server/runs/$id' });
  const initial = useRun(server, id);
  const stream = useOutputStream(runStreamUrl(server, id), { resumable: true });
  const qc = useQueryClient();
  const cancel = useCancelRun(server);
  const run = stream.run ?? initial.data?.run ?? null;
  const site = run?.site ?? initial.data?.meta?.site ?? '';
  const detail = useSite(server, site);
  const commits = useCommits(server, site, run?.from_sha ?? null, run?.to_sha ?? null);
  const canAct = useCan('admin');

  useEffect(() => {
    if (stream.ended && run) {
      void qc.invalidateQueries({ queryKey: keys.sites(server) });
      void qc.invalidateQueries({ queryKey: keys.site(server, run.site) });
      void qc.invalidateQueries({ queryKey: keys.siteRuns(server, run.site) });
      void qc.invalidateQueries({ queryKey: keys.db(server, run.site) });
    }
  }, [stream.ended, run, qc, server]);

  useEffect(() => {
    if (!run) return;
    const prev = document.title;
    const mark = { queued: '…', running: '…', succeeded: '✓', failed: '✗', skipped: '✓', unknown: '?' }[run.phase];
    document.title = `${mark} ${kindLabel(run.kind)} ${run.site} — ddeploy`;
    return () => {
      document.title = prev;
    };
  }, [run]);

  if (initial.isPending && !run) return <Spinner label="Loading run…" />;
  if (initial.error && !run) return <ErrorBox error={initial.error} title="Couldn't load this run" />;
  if (!run) return null;
  const repo = detail.data?.site.repo;
  const live = detail.data?.site.sha;
  const codeRun = ['deploy', 'rollback'].includes(run.kind);
  const cancellable = !!initial.data?.meta && !isTerminal(run.phase) && canAct;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-stone-500">
            {site && (
              <Link to="/s/$server/sites/$name" params={{ server, name: site }} className="hover:underline">
                {site}
              </Link>
            )}{' '}
            / run <Mono>{id}</Mono>
          </p>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-xl font-semibold">
            {kindLabel(run.kind)} {run.site}
            <PhaseBadge phase={run.phase} />
          </h1>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-stone-600 dark:text-stone-400">
            <span>by <Trigger trigger={run.trigger} author={run.author} /></span>
            {run.started_at && <span title={run.started_at}>started {relativeTime(run.started_at)}</span>}
            {isTerminal(run.phase) && run.duration_s != null && <span>took {duration(run.duration_s)}</span>}
            {run.branch && <span>branch {run.branch}</span>}
            {run.to_sha && (
              <span>
                {run.from_sha && run.from_sha !== run.to_sha && <><Commit sha={run.from_sha} repo={repo} /> → </>}
                <Commit sha={run.to_sha} repo={repo} subject={run.subject} />
              </span>
            )}
            {!run.to_sha && run.subject && <span>{run.subject}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {cancellable && (
            <ConfirmButton label="Cancel run" confirmLabel="Stop it now" icon={<Square className="size-4" aria-hidden />} busy={cancel.isPending} onConfirm={() => cancel.mutateAsync(id)} />
          )}
          {isTerminal(run.phase) && run.phase !== 'succeeded' && run.kind === 'deploy' && <DeployNowButton server={server} name={run.site} label="Retry deploy" />}
          {isTerminal(run.phase) && run.phase === 'succeeded' && codeRun && run.from_sha && run.from_sha !== run.to_sha && run.to_sha === live && (
            <RollbackButton server={server} name={run.site} sha={run.from_sha} label={`Undo (back to ${shortSha(run.from_sha)})`} />
          )}
        </div>
      </div>
      {cancel.error && <ErrorBox error={cancel.error} title="Couldn't cancel" />}

      {run.phase === 'queued' && (
        <div className="rounded-md border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-200">
          Waiting to start — another run on this site holds its lock; this one starts when it finishes.
        </div>
      )}
      {run.phase === 'failed' && !run.error && (
        <ErrorBox error="No error message was recorded — the output below shows what happened." title="Failed" hint={hintFor(stream.text)} />
      )}
      {run.error && (
        <ErrorBox
          error={
            run.error.includes('interrupted')
              ? `${run.error}. If it was past switching the release in, the new code stays live — check the site.`
              : run.error
          }
          title={run.phase === 'unknown' ? 'No result recorded' : 'Failed'}
          // The last error line often isn't the cause: an npm ERR! or AccessDenied further up is.
          hint={run.phase === 'failed' ? hintFor(stream.text) : null}
        />
      )}

      {commits.data && !commits.data.known && (
        <p className="text-sm text-stone-500">
          The commit list for this run isn't available: one of its commits isn't in the live checkout (a branch switch, or a force-push).
        </p>
      )}
      {commits.data && (commits.data.ahead.length > 0 || commits.data.behind.length > 0) && (
        <Card title="What changed">
          <CommitList title={`${commits.data.ahead.length} commit(s) deployed`} commits={commits.data.ahead} repo={repo} />
          <CommitList title={`${commits.data.behind.length} commit(s) taken back out`} commits={commits.data.behind} repo={repo} tone="behind" />
        </Card>
      )}

      <Card title="Output" actions={stream.ended ? <span className="text-xs text-stone-500">finished</span> : <span className="text-xs text-stone-500">{stream.connected ? 'live' : 'connecting…'}</span>}>
        <LogView text={stream.text} placeholder={run.phase === 'queued' ? 'Waiting for the run to start…' : 'No output yet.'} className="rounded-b-lg" />
      </Card>
    </div>
  );
}

function CommitList({ title, commits, repo, tone }: { title: string; commits: CommitT[]; repo?: string | null; tone?: 'behind' }) {
  if (!commits.length) return null;
  return (
    <div className="border-b border-stone-100 last:border-0 dark:border-stone-800">
      <p className={`px-4 pt-3 text-xs font-medium uppercase tracking-wide ${tone ? 'text-amber-700' : 'text-stone-500'}`}>{title}</p>
      <ul className="px-4 py-2">
        {commits.map((c) => {
          const url = commitUrl(repo, c.sha);
          return (
            <li key={c.sha} className="flex items-baseline gap-3 py-0.5 text-sm">
              {url ? <a href={url} target="_blank" rel="noreferrer" className="text-teal-700 hover:underline dark:text-teal-400"><Mono>{shortSha(c.sha)}</Mono></a> : <Mono>{shortSha(c.sha)}</Mono>}
              <span className="min-w-0 flex-1 truncate">{c.subject}</span>
              <span className="shrink-0 text-xs text-stone-500">{c.author} · {relativeTime(c.date)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
