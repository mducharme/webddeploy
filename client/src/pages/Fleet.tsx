import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { countStatuses, type CheckStatus, type SiteSummary } from '@webddeploy/shared';
import { ExternalLink, RefreshCw, Rocket, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Commit, Trigger } from '../components/RunTable.tsx';
import { Badge, Card, ConfirmButton, Empty, ErrorBox, PhaseBadge, Spinner, StatusDot, Td, Th, cx, inputClass } from '../components/ui.tsx';
import { dateTime, kindLabel, relativeTime, shortSha } from '../lib/format.ts';
import { useDeploy, useDoctor, useInfo, useRecentRuns, useSites } from '../lib/api.ts';
import { RunTable } from '../components/RunTable.tsx';
import { useCan } from '../lib/role.tsx';

/** The newest run, config changes aside (older ddeploy: the newest event). */
const lastRun = (s: SiteSummary) => (s.last_run !== undefined ? s.last_run : s.last_event);

export const FLEET_VIEWS = {
  all: { label: 'All', match: () => true },
  attention: {
    label: 'Needs attention',
    match: (s: SiteSummary, health?: CheckStatus) => health === 'warn' || health === 'fail' || lastRun(s)?.phase === 'failed',
  },
  running: { label: 'Running', match: (s: SiteSummary) => lastRun(s)?.phase === 'started' },
} as const satisfies Record<string, { label: string; match: (s: SiteSummary, health?: CheckStatus) => boolean }>;
export type FleetView = keyof typeof FLEET_VIEWS;

export function Fleet() {
  const { server } = useParams({ from: '/s/$server/' });
  const sites = useSites(server);
  const doctor = useDoctor(server);
  const [query, setQuery] = useState('');
  const [showPreviews, setShowPreviews] = useState(false);
  const [view, setView] = useState<FleetView>('all');

  const worst = useMemo(() => new Map<string, CheckStatus>(doctor.data?.sites.map((s) => [s.name, s.worst]) ?? []), [doctor.data]);

  const rows = useMemo(() => {
    const all = sites.data?.sites ?? [];
    const previewsOf = new Map<string, SiteSummary[]>();
    for (const s of all) if (s.preview) previewsOf.set(s.preview.project, [...(previewsOf.get(s.preview.project) ?? []), s]);
    const q = query.trim().toLowerCase();
    const matches = (s: SiteSummary) =>
      (!q || [s.name, s.branch, s.repo, s.subject].some((v) => v?.toLowerCase().includes(q))) && FLEET_VIEWS[view].match(s, worst.get(s.name));
    const out: Array<{ site: SiteSummary; previews: number; nested: boolean }> = [];
    for (const s of all) {
      if (s.preview) continue;
      const pv = previewsOf.get(s.name) ?? [];
      if (matches(s) || pv.some(matches)) {
        out.push({ site: s, previews: pv.length, nested: false });
        if (showPreviews) for (const p of pv) out.push({ site: p, previews: 0, nested: true });
      }
    }
    // Previews whose parent isn't provisioned (anymore) still show up.
    for (const s of all) if (s.preview && !all.some((p) => p.name === s.preview!.project) && matches(s)) out.push({ site: s, previews: 0, nested: false });
    return out;
  }, [sites.data, query, showPreviews, view, worst]);

  const counts = useMemo(() => {
    const all = sites.data?.sites ?? [];
    return Object.fromEntries(
      // Counted like the heading: sites, not their previews.
      (Object.keys(FLEET_VIEWS) as FleetView[]).map((v) => [v, all.filter((s) => !s.preview && FLEET_VIEWS[v].match(s, worst.get(s.name))).length]),
    ) as Record<FleetView, number>;
  }, [sites.data, worst]);

  return (
    <div className="space-y-6">
      <ServerCard server={server} />
      <Card
        title={`Sites${sites.data ? ` (${sites.data.sites.filter((s) => !s.preview).length})` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <div role="group" aria-label="Show" className="flex gap-1">
              {(Object.keys(FLEET_VIEWS) as FleetView[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={cx(
                    'rounded-full px-2.5 py-1 text-xs font-medium',
                    view === v ? 'bg-teal-700 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300',
                    v === 'attention' && counts.attention > 0 && view !== v && 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
                  )}
                >
                  {FLEET_VIEWS[v].label} <span className="opacity-70">{counts[v]}</span>
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-sm text-stone-600 dark:text-stone-300">
              <input type="checkbox" checked={showPreviews} onChange={(e) => setShowPreviews(e.target.checked)} />
              Show previews
            </label>
            <div className="relative">
              <Search className="absolute left-2 top-2 size-4 text-stone-400" aria-hidden />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter" aria-label="Filter sites" className={`${inputClass} w-48 pl-8`} />
            </div>
          </div>
        }
      >
        {sites.isPending ? (
          <Spinner label="Reading sites from ddeploy…" />
        ) : sites.error ? (
          <ErrorBox error={sites.error} title="Couldn't list sites" />
        ) : rows.length === 0 ? (
          <Empty>{query || view !== 'all' ? (view === 'attention' ? 'Nothing needs attention.' : 'No site matches.') : 'No sites provisioned yet.'}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem]">
              <thead className="border-b border-stone-200 dark:border-stone-800">
                <tr>
                  <Th className="w-8" />
                  <Th>Site</Th>
                  <Th>Live</Th>
                  <Th>Deployed</Th>
                  <Th>Last run</Th>
                  <Th>Stack</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {rows.map(({ site, previews, nested }) => (
                  <SiteRow key={site.name} server={server} site={site} previews={previews} nested={nested} status={doctor.data ? (worst.get(site.name) ?? 'off') : 'pending'} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <RecentRuns server={server} />
    </div>
  );
}

function SiteRow({ server, site, previews, nested, status }: { server: string; site: SiteSummary; previews: number; nested: boolean; status: CheckStatus | 'pending' }) {
  const deploy = useDeploy(server);
  const navigate = useNavigate();
  const canDeploy = useCan('admin');
  const ev = lastRun(site);
  const phase = ev ? (ev.phase === 'started' ? 'running' : ev.phase) : null;
  const deployedAt = site.deployed_at ?? site.last_deploy?.ts ?? null;
  // The last run is only worth its own line when it isn't the deploy itself.
  const separateRun = ev && ev.run_id !== site.last_deploy?.run_id;
  return (
    <tr className={cx('hover:bg-stone-50 dark:hover:bg-stone-800/40', (status === 'fail' || lastRun(site)?.phase === 'failed') && 'bg-red-50/50 dark:bg-red-950/20')}>
      <Td>
        <span className="mt-1.5 inline-block">
          <StatusDot status={status} label={status === 'pending' ? 'checking…' : `health: ${status}`} />
        </span>
      </Td>
      <Td>
        <div className={nested ? 'pl-5' : ''}>
          <Link to="/s/$server/sites/$name" params={{ server, name: site.name }} className="font-medium hover:underline">
            {site.name}
          </Link>
          {site.preview && <span className="ml-2"><Badge tone="neutral">preview · {site.preview.mode}</Badge></span>}
          {previews > 0 && <span className="ml-2 text-xs text-stone-500">{previews} preview{previews > 1 ? 's' : ''}</span>}
          <a href={site.url} target="_blank" rel="noreferrer" className="mt-0.5 flex items-center gap-1 text-xs text-stone-500 hover:text-teal-700">
            {site.url.replace('https://', '')} <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
      </Td>
      <Td className="max-w-sm">
        <div className="text-xs text-stone-500">{site.branch ?? 'detached'}</div>
        <Commit sha={site.sha} repo={site.repo} subject={site.subject} />
      </Td>
      <Td className="whitespace-nowrap">
        {deployedAt ? (
          <div className="space-y-0.5">
            <div className="text-sm" title={deployedAt}>{dateTime(deployedAt)}</div>
            <div className="text-xs text-stone-500">
              {relativeTime(deployedAt)}
              {site.last_deploy && <> · <Trigger trigger={site.last_deploy.trigger} author={site.last_deploy.author} /></>}
            </div>
          </div>
        ) : (
          <span className="text-sm text-stone-400">—</span>
        )}
      </Td>
      <Td className="whitespace-nowrap">
        {separateRun && ev ? (
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              {phase && <PhaseBadge phase={phase} />}
              <span className="text-sm" title={ev.ts}>{relativeTime(ev.ts)}</span>
            </div>
            <div className="text-xs text-stone-500">{kindLabel(ev.kind)} · <Trigger trigger={ev.trigger} author={ev.author} /></div>
          </div>
        ) : ev ? (
          <span className="text-xs text-stone-400">the deploy</span>
        ) : (
          <span className="text-sm text-stone-400">no history yet</span>
        )}
      </Td>
      <Td className="whitespace-nowrap text-xs text-stone-600 dark:text-stone-400">
        PHP {site.php ?? '?'}
        {site.node && <> · Node {site.node}{site.build && ' (build)'}</>}
      </Td>
      <Td className="text-right">
        {!site.preview && canDeploy && (
          <ConfirmButton
            label="Deploy"
            confirmLabel={`Deploy ${site.name}`}
            icon={<Rocket className="size-4" aria-hidden />}
            busy={deploy.isPending}
            onConfirm={() =>
              deploy.mutate(site.name, { onSuccess: ({ run_id }) => void navigate({ to: '/s/$server/runs/$id', params: { server, id: run_id } }) })
            }
          />
        )}
        {deploy.error && <p className="mt-1 text-xs text-red-700">{deploy.error.message}</p>}
      </Td>
    </tr>
  );
}

function ServerCard({ server }: { server: string }) {
  const info = useInfo(server);
  const doctor = useDoctor(server);
  const counts = doctor.data ? countStatuses(doctor.data) : null;
  const features = info.data?.features;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="p-4">
        <p className="text-xs uppercase tracking-wide text-stone-500">Server health</p>
        {doctor.isPending ? (
          <p className="mt-2 text-sm text-stone-500">Running checks…</p>
        ) : doctor.error ? (
          <p className="mt-2 text-sm text-red-700">{doctor.error.message}</p>
        ) : (
          <Link to="/s/$server/status" params={{ server }} className="mt-2 block">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <StatusDot status={doctor.data.server.worst} />
              {{ ok: 'Healthy', warn: 'Needs a look', fail: 'Failing', off: 'Off' }[doctor.data.server.worst]}
            </div>
            <p className="mt-1 text-sm text-stone-500">
              {counts!.ok} ok · {counts!.warn} warn · {counts!.fail} fail · checked {relativeTime(doctor.data.checked_at)}
            </p>
          </Link>
        )}
      </Card>
      <Card className="p-4">
        <p className="text-xs uppercase tracking-wide text-stone-500">Server</p>
        {info.data ? (
          <>
            <p className="mt-2 text-lg font-semibold">{info.data.hostname}</p>
            <p className="mt-1 text-sm text-stone-500">
              *.{info.data.base_domain} · ddeploy {shortSha(info.data.ddeploy.sha)}
              {info.data.ddeploy.branch && info.data.ddeploy.branch !== 'main' && ` (${info.data.ddeploy.branch})`}
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-stone-500">{info.error ? info.error.message : 'Loading…'}</p>
        )}
      </Card>
      <Card className="p-4">
        <p className="text-xs uppercase tracking-wide text-stone-500">Features</p>
        {features ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(
              [
                ['webhook', 'Deploy on push'],
                ['backups', 'Uploads backup'],
                ['db_backups', 'DB backup'],
                ['preview_prune', 'Preview pruning'],
              ] as const
            ).map(([k, label]) => (
              <Badge key={k} tone={features[k] ? 'ok' : 'off'}>{label}{features[k] ? '' : ' off'}</Badge>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-stone-500">Loading…</p>
        )}
      </Card>
    </div>
  );
}

function RecentRuns({ server }: { server: string }) {
  const runs = useRecentRuns(server);
  return (
    <Card title="Recent activity" actions={runs.isFetching ? <RefreshCw className="size-4 animate-spin text-stone-400" aria-hidden /> : null}>
      {runs.isPending ? <Spinner /> : runs.error ? <ErrorBox error={runs.error} /> : <RunTable runs={runs.data.runs} server={server} showSite empty="No runs recorded yet." />}
    </Card>
  );
}
