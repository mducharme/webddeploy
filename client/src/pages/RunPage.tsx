import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { deployRelation, isTerminal, type Commit as CommitT, hintFor, type Run, type RunStep } from '@webddeploy/shared';
import { Loader2, Square } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { LogView } from '../components/LogView.tsx';
import { Commit, Trigger } from '../components/RunTable.tsx';
import { Button, Card, ConfirmButton, ErrorBox, Mono, PhaseBadge, Spinner, cx } from '../components/ui.tsx';
import { keys, runStreamUrl, useCancelRun, useCommits, useRun, useSite, useSiteRuns } from '../lib/api.ts';
import { commitUrl, dateTime, duration, kindLabel, relativeTime, shortSha } from '../lib/format.ts';
import { sectionFor, splitBySteps, tail, type Section } from '../lib/runSteps.ts';
import { useSearchState } from '../lib/searchState.ts';
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
  const history = useSiteRuns(server, site);
  const steps = initial.data?.steps ?? [];
  const sections = useMemo(() => splitBySteps(stream.text), [stream.text]);
  const [stepParam, setStepParam] = useSearchState<string>('step', '');
  const failedLabel = run?.failed_step ?? steps.find((s) => s.status === 'failed')?.label ?? null;
  const selected = stepParam ? sectionFor(sections, stepParam) : undefined;

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
  const relation = codeRun && history.data ? deployRelation(run, history.data.runs) : null;
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
      {relation?.kind === 'same' && (
        <p className="rounded-md bg-stone-100 px-3 py-2 text-sm text-stone-700 dark:bg-stone-800 dark:text-stone-300" data-testid="deploy-relation">
          Same commit as before: nothing new was deployed (the build and hooks ran again).
        </p>
      )}
      {relation?.kind === 'earlier' && (
        <p className="rounded-md bg-stone-100 px-3 py-2 text-sm text-stone-700 dark:bg-stone-800 dark:text-stone-300" data-testid="deploy-relation">
          Same commit as the deploy of{' '}
          <Link to="/s/$server/runs/$id" params={{ server, id: relation.run.run_id }} className="text-teal-700 hover:underline">
            {dateTime(relation.run.finished_at ?? relation.run.started_at)}
          </Link>
          : this went back to code that was live before.
        </p>
      )}
      {run.phase === 'failed' && failedLabel ? (
        <FailureSummary
          run={run}
          label={failedLabel}
          section={sectionFor(sections, failedLabel)}
          onShow={() => setStepParam(failedLabel)}
        />
      ) : null}
      {run.phase === 'failed' && !failedLabel && !run.error && (
        <ErrorBox error="No error message was recorded — the output below shows what happened." title="Failed" hint={hintFor(stream.text)} />
      )}
      {run.error && !(run.phase === 'failed' && failedLabel) && (
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

      {steps.length > 0 && <StepsCard steps={steps} selected={selected?.label ?? null} onSelect={(l) => setStepParam(l ?? '')} running={!isTerminal(run.phase)} />}

      <Card
        title={selected ? <>Output: <span className="font-normal">{selected.label}</span></> : 'Output'}
        actions={
          <span className="flex items-center gap-2 text-xs text-stone-500">
            {selected && <Button variant="ghost" onClick={() => setStepParam('')}>All output</Button>}
            {stream.ended ? 'finished' : stream.connected ? 'live' : 'connecting…'}
          </span>
        }
      >
        <LogView
          filename={`${id}.log`}
          text={selected ? selected.text : stream.text}
          placeholder={run.phase === 'queued' ? 'Waiting for the run to start…' : selected ? 'This step printed nothing.' : 'No output yet.'}
          className="rounded-b-lg"
        />
      </Card>
    </div>
  );
}

const STEP_ICON = { ok: '✓', failed: '✗', running: '…', skipped: '–' } as const;

function StepsCard({ steps, selected, onSelect, running }: { steps: RunStep[]; selected: string | null; onSelect: (label: string | null) => void; running: boolean }) {
  return (
    <Card title="Steps" actions={<span className="text-xs text-stone-500">click one to see just its output</span>}>
      <ol className="divide-y divide-stone-100 dark:divide-stone-800" data-testid="run-steps">
        {steps.map((s, i) => (
          <li key={`${s.id}-${i}`}>
            <button
              type="button"
              onClick={() => onSelect(selected === s.label ? null : s.label)}
              aria-pressed={selected === s.label}
              className={cx(
                'flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-stone-50 dark:hover:bg-stone-800/50',
                selected === s.label && 'bg-teal-50 dark:bg-teal-950/30',
                s.status === 'failed' && 'bg-red-50/60 dark:bg-red-950/20',
              )}
            >
              <span
                className={cx(
                  'w-4 text-center font-bold',
                  s.status === 'ok' ? 'text-emerald-600' : s.status === 'failed' ? 'text-red-600' : 'text-stone-400',
                )}
                aria-label={s.status}
              >
                {s.status === 'running' && running ? <Loader2 className="inline size-3.5 animate-spin" aria-hidden /> : STEP_ICON[s.status]}
              </span>
              <span className={cx('min-w-0 flex-1 truncate', s.status === 'failed' && 'font-medium text-red-800 dark:text-red-300')}>{s.label}</span>
              <span className="text-xs tabular-nums text-stone-500">{s.duration_s != null ? duration(s.duration_s) : s.status === 'running' ? 'running' : ''}</span>
            </button>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** A failed run, said plainly: which step, what it means for the live site, the step's last lines, what to do. */
function FailureSummary({ run, label, section, onShow }: { run: Run; label: string; section?: Section; onShow: () => void }) {
  const last = section ? tail(section.text) : '';
  const hint = hintFor(last) ?? hintFor(run.error);
  return (
    <div role="alert" className="overflow-hidden rounded-md border border-red-300 bg-red-50 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200" data-testid="failure-summary">
      <div className="space-y-1 p-3">
        <p className="font-medium">Failed at “{label}”</p>
        {run.went_live === false && <p>It stopped before going live: the site still runs the previous release, untouched.</p>}
        {run.went_live === true && <p>It failed after going live: the new code is running, but this step didn't finish — check the site.</p>}
        {run.error && <p className="break-words">{run.error}</p>}
        {hint && (
          <p className="border-t border-red-200 pt-2 dark:border-red-900">
            <span className="font-medium">{hint.cause}</span> {hint.next}
          </p>
        )}
      </div>
      {last && (
        <>
          <pre className="max-h-64 overflow-auto bg-stone-950 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-stone-200">{last}</pre>
          <div className="flex justify-end bg-red-100/60 px-3 py-1.5 dark:bg-red-950/60">
            <Button variant="ghost" onClick={onShow}>Show this step's full output</Button>
          </div>
        </>
      )}
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
