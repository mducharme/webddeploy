import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { hintFor, type Run } from '@webddeploy/shared';
import { useEffect } from 'react';
import { toast } from '../components/Toaster.tsx';
import { keys } from './api.ts';
import { kindLabel } from './format.ts';

export interface LiveMessage {
  running: Run[];
  finished: Run[];
  changed_sites: string[];
}

export const liveKey = (server: string) => ['live', server] as const;

/** What a finished run's toast says. */
export function finishedToast(run: Run) {
  const what = `${kindLabel(run.kind)} ${run.site}`;
  if (run.phase === 'succeeded') return { tone: 'success' as const, message: `${what} succeeded`, detail: run.subject ?? undefined };
  if (run.phase === 'failed') {
    const hint = hintFor(run.error);
    const where = run.failed_step ? ` at “${run.failed_step}”` : '';
    const live = run.went_live === false ? 'The previous release is still live.' : run.went_live === true ? 'It failed after going live.' : null;
    return { tone: 'error' as const, message: `${what} failed${where}`, detail: [live, run.error, hint?.next].filter(Boolean).join(' — ') || undefined };
  }
  return { tone: 'info' as const, message: `${what}: ${run.phase}` };
}

/** Applies one message: the running list, fresh lists for what changed, a toast per finished run. */
export function applyLive(qc: QueryClient, server: string, m: LiveMessage, currentPath: string) {
  qc.setQueryData(liveKey(server), m.running);
  if (m.changed_sites.length || m.finished.length) {
    void qc.invalidateQueries({ queryKey: keys.runs(server) });
    void qc.invalidateQueries({ queryKey: keys.sites(server) });
    void qc.invalidateQueries({ queryKey: ['siteNames', server] });
    const sites = new Set([...m.changed_sites, ...m.finished.map((r) => r.site)]);
    void qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === server && q.queryKey.some((k) => typeof k === 'string' && sites.has(k)) });
  }
  for (const run of m.finished) {
    // The run's own page already says it, live.
    if (currentPath.endsWith(`/runs/${run.run_id}`)) continue;
    toast({ ...finishedToast(run), link: { label: 'View the run', to: '/s/$server/runs/$id', params: { server, id: run.run_id } } });
  }
}

/** One live connection per tab (kept in the layout): runs starting and finishing, as they happen. */
export function useLiveStream(server: string) {
  const qc = useQueryClient();
  useEffect(() => {
    // EventSource reconnects by itself; each (re)connection starts with the full state.
    const es = new EventSource(`/api/servers/${encodeURIComponent(server)}/live`);
    es.addEventListener('live', (e) => applyLive(qc, server, JSON.parse((e as MessageEvent<string>).data) as LiveMessage, window.location.pathname));
    return () => es.close();
  }, [server, qc]);
}

export const useRunning = (server: string) =>
  useQuery({ queryKey: liveKey(server), queryFn: () => [] as Run[], enabled: false, initialData: [] as Run[] }).data;
