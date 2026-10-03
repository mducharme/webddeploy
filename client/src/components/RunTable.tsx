import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { parseTrigger, patterns, type Run } from '@webddeploy/shared';
import { commitUrl, duration, kindLabel, relativeTime, shortSha } from '../lib/format.ts';
import { Empty, Mono, PhaseBadge, Td, Th } from './ui.tsx';

export function Trigger({ trigger, author }: { trigger: string; author?: string | null }) {
  const a = parseTrigger(trigger, author);
  let via: string | null = null;
  if (a.type === 'web') via = 'web';
  else if (a.type === 'manual') via = 'CLI';
  else if (a.type === 'webhook') via = a.label === 'git push' ? null : 'git push';
  const who = a.type === 'unknown' && trigger === 'unknown' ? '—' : a.label;
  const title = author && author !== who ? `${trigger} — commit by ${author}` : trigger;
  return (
    <span className="text-stone-600 dark:text-stone-400" title={title}>
      {who}
      {via && <span className="ml-1 text-xs text-stone-400">({via})</span>}
    </span>
  );
}

export function Commit({ sha, repo, subject }: { sha: string | null; repo?: string | null; subject?: string | null }) {
  const url = commitUrl(repo, sha);
  return (
    <span className="inline-flex min-w-0 max-w-[min(22rem,100%)] items-baseline gap-2 align-baseline">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="text-teal-700 hover:underline dark:text-teal-400">
          <Mono>{shortSha(sha)}</Mono>
        </a>
      ) : (
        <Mono>{shortSha(sha)}</Mono>
      )}
      {subject && <span className="min-w-0 truncate text-stone-600 dark:text-stone-400" title={subject}>{subject}</span>}
    </span>
  );
}

export function RunTable({
  runs,
  server,
  repo,
  showSite = false,
  empty = 'Nothing recorded yet.',
  pageSize = 25,
  actions,
}: {
  runs: Run[];
  server: string;
  repo?: string | null;
  showSite?: boolean;
  empty?: string;
  pageSize?: number;
  /** Extra per-row controls (rollback, retry), right-aligned in a last column. */
  actions?: (run: Run) => ReactNode;
}) {
  const [shown, setShown] = useState(pageSize);
  if (runs.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem]">
        <thead className="border-b border-stone-200 dark:border-stone-800">
          <tr>
            <Th>When</Th>
            {showSite && <Th>Site</Th>}
            <Th>What</Th>
            <Th>Result</Th>
            <Th>Commit / change</Th>
            <Th>By</Th>
            <Th className="text-right">Took</Th>
            {actions && <Th />}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
          {runs.slice(0, shown).map((r) => (
            <tr key={r.run_id} className="hover:bg-stone-50 dark:hover:bg-stone-800/40">
              <Td className="whitespace-nowrap">
                {r.legacy || !patterns.runId.test(r.run_id) ? (
                  <span title={r.finished_at ?? r.started_at ?? ''}>{relativeTime(r.started_at ?? r.finished_at)}</span>
                ) : (
                  <Link
                    to="/s/$server/runs/$id"
                    params={{ server, id: r.run_id }}
                    className="text-teal-700 hover:underline dark:text-teal-400"
                    title={r.started_at ?? r.finished_at ?? ''}
                  >
                    {relativeTime(r.started_at ?? r.finished_at)}
                  </Link>
                )}
              </Td>
              {showSite && (
                <Td>
                  <Link to="/s/$server/sites/$name" params={{ server, name: r.site }} className="font-medium hover:underline">
                    {r.site}
                  </Link>
                </Td>
              )}
              <Td className="whitespace-nowrap">
                {kindLabel(r.kind)}
                {r.branch && <span className="ml-1 text-xs text-stone-500">{r.branch}</span>}
              </Td>
              <Td>
                <PhaseBadge phase={r.phase} />
                {r.error && <p className="mt-1 max-w-md text-xs text-red-700 dark:text-red-400">{r.error}</p>}
              </Td>
              <Td>
                {r.to_sha ? (
                  <Commit sha={r.to_sha} repo={repo} subject={r.subject} />
                ) : r.subject ? (
                  <span className="block max-w-[26rem] truncate text-stone-600 dark:text-stone-400" title={r.subject}>{r.subject}</span>
                ) : null}
              </Td>
              <Td className="whitespace-nowrap">{r.legacy ? <span className="text-xs text-stone-400">before history</span> : <Trigger trigger={r.trigger} author={r.author} />}</Td>
              <Td className="whitespace-nowrap text-right tabular-nums">{duration(r.duration_s)}</Td>
              {actions && <Td className="whitespace-nowrap text-right">{actions(r)}</Td>}
            </tr>
          ))}
        </tbody>
      </table>
      {runs.length > shown && (
        <div className="border-t border-stone-100 p-2 text-center dark:border-stone-800">
          <button type="button" onClick={() => setShown((n) => n + pageSize * 2)} className="text-sm text-teal-700 hover:underline dark:text-teal-400">
            Show more ({runs.length - shown} older)
          </button>
        </div>
      )}
    </div>
  );
}
