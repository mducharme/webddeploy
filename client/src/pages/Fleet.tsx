import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { countStatuses, type CheckStatus, type SiteNamesResponse, type SiteSummary } from '@webddeploy/shared';
import { ExternalLink, Loader2, RefreshCw, Rocket, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Commit, Trigger } from '../components/RunTable.tsx';
import { Badge, Card, ConfirmButton, Empty, ErrorBox, PhaseBadge, Spinner, StatusDot, Td, Th, cx, inputClass, InlineError } from '../components/ui.tsx';
import { dateTime, kindLabel, relativeTime, shortSha } from '../lib/format.ts';
import { useDeploy, useDoctor, useDoctorSnapshot, useInfo, useRecentRuns, useRefreshFleet, useSiteNames, useSites } from '../lib/api.ts';
import { RunTable } from '../components/RunTable.tsx';
import { useCan } from '../lib/role.tsx';
import { useSearchState } from '../lib/searchState.ts';
import { RefreshBar } from '../components/RefreshBar.tsx';

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
  // Each site's health comes with it (ddeploy's last scheduled check). An
  // older ddeploy doesn't send it: then the checks run here, as before.
  const hasHealth = !!sites.data?.sites.some((s) => s.health != null);
  const doctor = useDoctor(server, undefined, { enabled: !!sites.data && !hasHealth });
  const refresh = useRefreshFleet(server);
  // Names come back at once; the full list (deploys, runs) a moment later.
  const names = useSiteNames(server);
  const [query, setQuery] = useSearchState<string>('q', '');
  const [showPreviews, setShowPreviews] = useSearchState<boolean>('previews', false);
  const [view, setView] = useSearchState<FleetView>('view', 'all');

  const worst = useMemo(() => new Map<string, CheckStatus>(doctor.data?.sites.map((s) => [s.name, s.worst]) ?? []), [doctor.data]);
  const healthOf = useMemo(
    () => (s: SiteSummary) => siteHealth(s, hasHealth, doctor.data ? { checkedAt: doctor.data.checked_at, worst } : undefined),
    [hasHealth, doctor.data, worst],
  );

  const rows = useMemo(() => {
    const all = sites.data?.sites ?? [];
    const previewsOf = new Map<string, SiteSummary[]>();
    for (const s of all) if (s.preview) previewsOf.set(s.preview.project, [...(previewsOf.get(s.preview.project) ?? []), s]);
    const q = query.trim().toLowerCase();
    const matches = (s: SiteSummary) =>
      (!q || [s.name, s.branch, s.repo, s.subject].some((v) => v?.toLowerCase().includes(q))) && FLEET_VIEWS[view].match(s, statusOnly(healthOf(s)));
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
  }, [sites.data, query, showPreviews, view, healthOf]);

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
        title={
          <span className="flex flex-wrap items-center gap-x-3">
            {`Sites${sites.data ? ` (${sites.data.sites.filter((s) => !s.preview).length})` : ''}`}
            <RefreshBar updatedAt={sites.dataUpdatedAt} refreshing={refresh.isPending || (sites.isFetching && !sites.data)} onRefresh={() => refresh.mutate()} className="font-normal" />
          </span>
        }
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
        {sites.isPending && names.data ? (
          <PendingSites server={server} names={names.data.sites} query={query} showPreviews={showPreviews} />
        ) : sites.isPending ? (
          <Spinner size="lg" label="Loading sites…" />
        ) : sites.error ? (
          <ErrorBox error={sites.error} title="Couldn't list sites" />
        ) : rows.length === 0 ? (
          <Empty>{query || view !== 'all' ? (view === 'attention' ? 'Nothing needs attention.' : 'No site matches.') : 'No sites provisioned yet.'}</Empty>
        ) : (
          <>
          {/* Phones: one card per site instead of a table to scroll sideways. */}
          <ul className="divide-y divide-stone-100 md:hidden dark:divide-stone-800" data-testid="site-cards">
            {rows.map(({ site, previews, nested }) => (
              <SiteCard key={site.name} server={server} site={site} previews={previews} nested={nested} health={healthOf(site)} />
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[48rem]">
              <thead className="border-b border-stone-200 dark:border-stone-800">
                <tr>
                  <Th className="w-8" />
                  <Th>Site</Th>
                  <Th>Live</Th>
                  <Th>Deployed</Th>
                  <Th>Last run</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {rows.map(({ site, previews, nested }) => (
                  <SiteRow key={site.name} server={server} site={site} previews={previews} nested={nested} health={healthOf(site)} />
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>
      <RecentRuns server={server} />
    </div>
  );
}

/** The site names, already clickable, while their details load — in the same table as the full list. */
function PendingSites({ server, names, query, showPreviews }: { server: string; names: SiteNamesResponse['sites']; query: string; showPreviews: boolean }) {
  const q = query.trim().toLowerCase();
  const projects = names.filter((n) => !n.preview);
  const previewsOf = (p: string) => names.filter((n) => n.preview?.project === p);
  const rows = projects
    .filter((p) => !q || p.name.toLowerCase().includes(q) || previewsOf(p.name).some((n) => n.name.toLowerCase().includes(q)))
    .flatMap((p) => [{ n: p, nested: false, previews: previewsOf(p.name).length }, ...(showPreviews ? previewsOf(p.name).map((n) => ({ n, nested: true, previews: 0 })) : [])]);
  const bar = (w: string) => <span className={cx('inline-block h-2.5 animate-pulse rounded bg-stone-200 align-middle dark:bg-stone-800', w)} />;
  return (
    <div data-testid="pending-sites">
      <p className="flex items-center gap-2 border-b border-stone-100 px-4 py-2 text-xs text-stone-500 md:hidden dark:border-stone-800">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading deploys and runs…
      </p>
      <ul className="divide-y divide-stone-100 md:hidden dark:divide-stone-800">
        {rows.map(({ n, nested, previews }) => (
          <li key={n.name} className={cx('flex items-start gap-2 px-4 py-3', nested && 'pl-8')}>
            <span className="mt-1.5"><StatusDot status="pending" label="checking…" /></span>
            <SiteNameCell server={server} name={n.name} url={n.url} preview={n.preview ? 'preview' : null} previews={previews} nested={false} />
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[48rem]">
          <thead className="border-b border-stone-200 dark:border-stone-800">
            <tr>
              <Th className="w-8" />
              <Th>Site</Th>
              <Th>Live</Th>
              <Th>Deployed</Th>
              <Th>Last run</Th>
              {/* In the header, not above the table: the rows don't move when the details arrive. */}
              <Th className="text-right">
                <span className="inline-flex items-center gap-1 leading-none normal-case"><Loader2 className="size-3 animate-spin" aria-hidden /> Loading…</span>
              </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
            {rows.map(({ n, nested, previews }) => (
              <tr key={n.name}>
                <Td>
                  <span className="mt-1.5 inline-block"><StatusDot status="pending" label="checking…" /></span>
                </Td>
                <Td>
                  <SiteNameCell server={server} name={n.name} url={n.url} preview={n.preview ? 'preview' : null} previews={previews} nested={nested} />
                </Td>
                <Td><div className="space-y-1">{bar('w-16')}<div>{bar('w-64')}</div></div></Td>
                <Td><div className="space-y-1">{bar('w-24')}<div>{bar('w-20')}</div></div></Td>
                <Td><div className="space-y-1">{bar('w-20')}<div>{bar('w-28')}</div></div></Td>
                <Td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export interface Health {
  status: CheckStatus | 'pending';
  /** When that check ran (absent: never checked, or still checking). */
  checkedAt?: string;
}

/**
 * A site's health dot: its own `health` (ddeploy's last scheduled check)
 * when the sites payload carries it; otherwise (an older ddeploy) the
 * checks run by this page, or "pending" while they do.
 */
export function siteHealth(s: SiteSummary, fromSites: boolean, checked?: { checkedAt: string; worst: Map<string, CheckStatus> }): Health {
  if (fromSites) return { status: s.health ?? 'off', checkedAt: s.health_checked_at };
  if (checked) return { status: checked.worst.get(s.name) ?? 'off', checkedAt: checked.checkedAt };
  return { status: 'pending' };
}

const statusOnly = (h: Health): CheckStatus | undefined => (h.status === 'pending' ? undefined : h.status);

export function healthLabel({ status, checkedAt }: Health): string {
  if (status === 'pending') return 'checking…';
  if (!checkedAt) return 'health: not checked yet';
  return `health: ${status} · checked ${relativeTime(checkedAt)}`;
}

function SiteCard({ server, site, previews, nested, health }: { server: string; site: SiteSummary; previews: number; nested: boolean; health: Health }) {
  const status = health.status;
  const deploy = useDeploy(server);
  const navigate = useNavigate();
  const canDeploy = useCan('admin');
  const ev = lastRun(site);
  const deployedAt = site.deployed_at ?? site.last_deploy?.ts ?? null;
  return (
    <li className={cx('space-y-1.5 px-4 py-3', nested && 'pl-8', (status === 'fail' || ev?.phase === 'failed') && 'bg-red-50/50 dark:bg-red-950/20')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={status} label={healthLabel(health)} />
            <Link to="/s/$server/sites/$name" params={{ server, name: site.name }} className="font-medium hover:underline">{site.name}</Link>
            {site.preview && <Badge tone="neutral">preview</Badge>}
            {previews > 0 && <span className="text-xs text-stone-500">{previews} preview{previews > 1 ? 's' : ''}</span>}
          </div>
          <a href={site.url} target="_blank" rel="noreferrer" className="mt-0.5 flex items-center gap-1 truncate text-xs text-stone-500">
            {site.url.replace('https://', '')} <ExternalLink className="size-3 shrink-0" aria-hidden />
          </a>
        </div>
        {!site.preview && canDeploy && (
          <ConfirmButton
            label="Deploy" busyLabel="Starting…"
            confirmLabel={`Deploy ${site.name}`}
            icon={<Rocket className="size-4" aria-hidden />}
            busy={deploy.isPending}
            onConfirm={() => deploy.mutateAsync(site.name, { onSuccess: ({ run_id }) => void navigate({ to: '/s/$server/runs/$id', params: { server, id: run_id } }) })}
          />
        )}
      </div>
      <div className="text-xs text-stone-500">{site.branch ?? 'detached'} · <Commit sha={site.sha} repo={site.repo} subject={site.subject} /></div>
      <div className="flex flex-wrap gap-x-3 text-xs text-stone-500">
        {deployedAt && <span>Deployed {relativeTime(deployedAt)}{site.last_deploy && <> by <Trigger trigger={site.last_deploy.trigger} author={site.last_deploy.author} /></>}</span>}
        {ev && ev.run_id !== site.last_deploy?.run_id && (
          <span className="inline-flex items-center gap-1">
            <PhaseBadge phase={ev.phase === 'started' ? 'running' : ev.phase} /> {kindLabel(ev.kind)} {relativeTime(ev.ts)}
          </span>
        )}
      </div>
    </li>
  );
}

/** The Site column: the same while details load and after, so nothing jumps. */
function SiteNameCell({ server, name, url, preview, previews, nested }: { server: string; name: string; url?: string; preview: string | null; previews: number; nested: boolean }) {
  return (
    <div className={nested ? 'pl-5' : ''}>
      <Link to="/s/$server/sites/$name" params={{ server, name }} className="font-medium hover:underline">
        {name}
      </Link>
      {preview && <span className="ml-2"><Badge tone="neutral">{preview}</Badge></span>}
      {previews > 0 && <span className="ml-2 text-xs text-stone-500">{previews} preview{previews > 1 ? 's' : ''}</span>}
      {/* An older ddeploy's site-names has no url: just the name then. */}
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="mt-0.5 flex items-center gap-1 text-xs text-stone-500 hover:text-teal-700">
          {url.replace('https://', '')} <ExternalLink className="size-3" aria-hidden />
        </a>
      )}
    </div>
  );
}

function SiteRow({ server, site, previews, nested, health }: { server: string; site: SiteSummary; previews: number; nested: boolean; health: Health }) {
  const status = health.status;
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
          <StatusDot status={status} label={healthLabel(health)} />
        </span>
      </Td>
      <Td>
        <SiteNameCell server={server} name={site.name} url={site.url} preview={site.preview ? `preview · ${site.preview.mode}` : null} previews={previews} nested={nested} />
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
      <Td className="text-right">
        {!site.preview && canDeploy && (
          <ConfirmButton
            label="Deploy" busyLabel="Starting…"
            confirmLabel={`Deploy ${site.name}`}
            icon={<Rocket className="size-4" aria-hidden />}
            busy={deploy.isPending}
            onConfirm={() =>
              deploy.mutateAsync(site.name, { onSuccess: ({ run_id }) => void navigate({ to: '/s/$server/runs/$id', params: { server, id: run_id } }) })
            }
          />
        )}
        {deploy.error && <InlineError error={deploy.error} className="mt-1 text-xs text-red-700" />}
      </Td>
    </tr>
  );
}

function ServerCard({ server }: { server: string }) {
  const info = useInfo(server);
  // The last scheduled check, not a new one: the homepage never waits on it.
  const doctor = useDoctorSnapshot(server);
  const server_ = doctor.data?.server ?? null;
  const counts = doctor.data && server_ ? countStatuses({ ...doctor.data, server: server_, checked_at: doctor.data.checked_at ?? '' }) : null;
  const features = info.data?.features;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="p-4">
        <p className="text-xs uppercase tracking-wide text-stone-500">Server health</p>
        {doctor.isPending ? (
          <p className="mt-2 text-sm text-stone-500">Loading…</p>
        ) : doctor.error ? (
          <InlineError error={doctor.error} className="mt-2 text-sm text-red-700" />
        ) : !server_ || !counts ? (
          <Link to="/s/$server/status" params={{ server }} className="mt-2 block text-sm text-stone-500 hover:underline">
            Not checked yet — run the checks
          </Link>
        ) : (
          <Link to="/s/$server/status" params={{ server }} className="mt-2 block">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <StatusDot status={server_.worst} />
              {{ ok: 'Healthy', warn: 'Needs a look', fail: 'Failing', off: 'Off' }[server_.worst]}
            </div>
            <p className="mt-1 text-sm text-stone-500">
              {counts.ok} ok · {counts.warn} warn · {counts.fail} fail · checked {relativeTime(doctor.data.checked_at ?? '')}
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
    <Card
      title={
        <span>
          Recent activity <span className="ml-1 text-xs font-normal text-stone-500">every run: web UI, git push, schedule, command line</span>
        </span>
      }
      actions={
        <span className="flex items-center gap-2">
          {runs.isFetching && <RefreshCw className="size-4 animate-spin text-stone-400" aria-hidden />}
          <Link to="/activity" className="text-sm text-teal-700 hover:underline dark:text-teal-400">See all</Link>
        </span>
      }
    >
      {runs.isPending ? <Spinner /> : runs.error ? <ErrorBox error={runs.error} /> : <RunTable runs={runs.data.runs} server={server} showSite empty="No runs recorded yet." />}
    </Card>
  );
}
