import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import type { SiteDetailResponse } from '@webddeploy/shared';
import { ExternalLink } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Checks } from '../components/Checks.tsx';
import { LogView } from '../components/LogView.tsx';
import { Commit } from '../components/RunTable.tsx';
import { DatabaseTab } from './DatabaseTab.tsx';
import { EnvTab } from './EnvTab.tsx';
import { FilesTab } from './FilesTab.tsx';
import { BackupsTab } from './BackupsTab.tsx';
import { HistoryTab } from './HistoryTab.tsx';
import { OverviewTab } from './OverviewTab.tsx';
import { SettingsTab } from './SettingsTab.tsx';
import { DeployNowButton } from './siteShared.tsx';
import { useCan } from '../lib/role.tsx';
import { RefreshBar } from '../components/RefreshBar.tsx';
import { SiteSwitcher } from '../components/SiteSwitcher.tsx';
import { useSearchState } from '../lib/searchState.ts';
import { PreviewActions, PreviewsTab } from './PreviewsTab.tsx';
import { Badge, Button, Card, Empty, ErrorBox, Mono, Spinner, StatusDot, Tabs } from '../components/ui.tsx';
import { logStreamUrl, useDoctor, useLogs, useRefreshSite, useSite } from '../lib/api.ts';
import { relativeTime } from '../lib/format.ts';
import { useOutputStream } from '../lib/stream.ts';

export const SITE_TABS = ['overview', 'history', 'environment', 'settings', 'database', 'files', 'backups', 'previews', 'logs', 'health', 'config'] as const;
export type SiteTab = (typeof SITE_TABS)[number];

export function SitePage() {
  const { server, name } = useParams({ from: '/s/$server/sites/$name' });
  const { tab } = useSearch({ from: '/s/$server/sites/$name' });
  const navigate = useNavigate({ from: '/s/$server/sites/$name' });
  const site = useSite(server, name);
  const refresh = useRefreshSite(server, name);
  const isAdmin = useCan('admin');

  if (site.isPending) {
    // The name and the switcher at once: going to another site doesn't wait for this one.
    return (
      <div className="space-y-4">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          {name}
          <SiteSwitcher server={server} current={name} />
        </h1>
        <Spinner size="lg" label={`Loading ${name}…`} />
      </div>
    );
  }
  if (site.error) return <ErrorBox error={site.error} title={`Couldn't load ${name}`} />;
  const d = site.data;
  const s = d.site;
  // Viewers: no environment (secrets) or database (data) tabs.
  const ADMIN_TABS: readonly SiteTab[] = ['environment', 'database'];
  const tabs = SITE_TABS.filter((t) => !(t === 'previews' && s.preview) && (isAdmin || !ADMIN_TABS.includes(t))).map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) }));
  const current: SiteTab = tabs.some((t) => t.id === tab) ? tab : 'overview';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            {s.name}
            <SiteSwitcher server={server} current={s.name} />
            {s.preview && <Badge tone="neutral">preview of {s.preview.project} · {s.preview.mode}</Badge>}
          </h1>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-600 dark:text-stone-400">
            {(d.config?.hostnames ?? [s.url.replace('https://', '')]).concat(d.config?.custom_domains ?? []).map((h) => (
              <a key={h} href={`https://${h}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-teal-700">
                {h} <ExternalLink className="size-3" aria-hidden />
              </a>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-stone-500">{s.branch ?? 'detached'}</span>
            <Commit sha={s.sha} repo={s.repo} subject={s.subject} />
            {s.committed_at && <span className="text-xs text-stone-400">committed {relativeTime(s.committed_at)}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {!s.preview && <DeployNowButton server={server} name={s.name} confirmLabel={`Deploy ${s.branch ?? 'branch'} to ${s.name}`} />}
          {s.preview && <PreviewActions server={server} project={s.preview.project} branch={s.preview.branch} mode={s.preview.mode} />}
          <RefreshBar updatedAt={site.dataUpdatedAt} refreshing={refresh.isPending} onRefresh={() => refresh.mutate()} />
        </div>
      </div>

      <Tabs tabs={tabs} value={current} onChange={(t) => void navigate({ search: { tab: t }, replace: true })} />

      {current === 'overview' && <OverviewTab server={server} detail={d} />}
      {current === 'history' && <HistoryTab server={server} detail={d} />}
      {current === 'environment' && <EnvTab server={server} name={name} isPreview={!!s.preview} />}
      {current === 'settings' && <SettingsTab server={server} detail={d} />}
      {current === 'database' && <DatabaseTab server={server} name={name} />}
      {current === 'files' && <FilesTab server={server} name={name} />}
      {current === 'backups' && <BackupsTab server={server} name={name} />}
      {current === 'previews' && <PreviewsTab server={server} project={name} repo={s.repo} />}
      {current === 'logs' && <SiteLog server={server} name={name} />}
      {current === 'health' && <HealthTab server={server} name={name} />}
      {current === 'config' && <ConfigTab detail={d} />}
    </div>
  );
}

/** What an empty log is, by kind: an error log with nothing in it is good news. */
export function emptyLogText(name: string): string {
  if (name.endsWith('.error') || name.endsWith('_error')) return 'No errors logged yet — new ones appear here as they happen.';
  if (name.endsWith('.access') || name.endsWith('_access')) return 'No requests logged yet — they appear here as they come in.';
  return 'Nothing logged yet — new lines appear here as they are written.';
}

/** Follows one log live. */
export function LogStream({ server, name, title }: { server: string; name: string; title?: ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  return <LogStreamInner key={attempt} server={server} name={name} title={title} onReconnect={() => setAttempt((n) => n + 1)} />;
}

function LogStreamInner({ server, name, title, onReconnect }: { server: string; name: string; title?: ReactNode; onReconnect: () => void }) {
  const stream = useOutputStream(logStreamUrl(server, name));
  const lost = !stream.connected && !stream.ended && (stream.loaded || !!stream.error);
  return (
    <Card
      title={title ?? <>Log: <Mono>{name}</Mono></>}
      actions={
        <span className="flex items-center gap-2 text-xs text-stone-500">
          <span className="flex items-center gap-1.5"><StatusDot status={stream.connected ? 'ok' : 'off'} />{stream.connected ? 'following' : stream.loaded || stream.error ? 'disconnected' : 'connecting…'}</span>
          {lost && <Button variant="ghost" onClick={onReconnect}>Reconnect</Button>}
        </span>
      }
    >
      {stream.error && <ErrorBox error={stream.error} title="Couldn't read the log" />}
      <LogView filename={`${name}.log`} text={stream.text} placeholder={stream.loaded ? emptyLogText(name) : 'Loading the log…'} className="rounded-b-lg" />
    </Card>
  );
}

const SITE_LOGS = [
  { suffix: '', label: 'Deploys & previews', help: "ddeploy's own log for this site" },
  { suffix: '.error', label: 'Errors (nginx + PHP)', help: 'nginx errors, and PHP errors and warnings PHP-FPM reports' },
  { suffix: '.access', label: 'Access', help: 'every request nginx served for this site' },
] as const;

/** A site's three logs, one at a time. */
export function SiteLog({ server, name }: { server: string; name: string }) {
  const [log, setLog] = useSearchState<'' | 'error' | 'access'>('log', '');
  const which = (log ? `.${log}` : '') as (typeof SITE_LOGS)[number]['suffix'];
  const setWhich = (s: (typeof SITE_LOGS)[number]['suffix']) => setLog(s.slice(1) as '' | 'error' | 'access');
  const logs = useLogs(server);
  const logName = name + which;
  const exists = logs.data ? logs.data.logs.some((l) => l.name === logName) : true;
  const current = SITE_LOGS.find((l) => l.suffix === which)!;
  return (
    <div className="space-y-3">
      <div role="group" aria-label="Which log" className="flex flex-wrap items-center gap-2">
        {SITE_LOGS.map((l) => (
          <Button key={l.suffix} variant={which === l.suffix ? 'primary' : 'secondary'} onClick={() => setWhich(l.suffix)} title={l.help}>
            {l.label}
          </Button>
        ))}
      </div>
      {exists ? (
        <LogStream key={logName} server={server} name={logName} title={<>{current.label} <span className="font-normal text-stone-500">— {current.help}</span></>} />
      ) : (
        <Card className="p-4 text-sm text-stone-600 dark:text-stone-400">
          This site doesn't have its own nginx logs yet: they're set up on its next deploy (ddeploy writes them per site from this version on).
          Until then, its requests and PHP errors are in the server-wide nginx logs on the Logs page.
        </Card>
      )}
    </div>
  );
}

function HealthTab({ server, name }: { server: string; name: string }) {
  const doctor = useDoctor(server, name);
  if (doctor.isPending) return <Spinner label="Running checks…" />;
  if (doctor.error) return <ErrorBox error={doctor.error} />;
  const site = doctor.data.sites.find((s) => s.name === name);
  return (
    <Card title="Health checks" actions={<span className="text-xs text-stone-500">checked {relativeTime(doctor.data.checked_at)}</span>}>
      <Checks checks={site?.checks ?? []} />
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 px-4 py-2 sm:grid-cols-[12rem_1fr]">
      <dt className="text-sm text-stone-500">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

const list = (xs: string[] | undefined) => (xs && xs.length ? xs.map((x) => <Mono key={x} className="mr-2 block sm:inline">{x}</Mono>) : <span className="text-stone-400">none</span>);

function ConfigTab({ detail }: { detail: SiteDetailResponse }) {
  const c = detail.config;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Resolved configuration">
        {detail.config_error && <ErrorBox error={detail.config_error} title="Config doesn't parse" />}
        {c && (
          <dl className="divide-y divide-stone-100 dark:divide-stone-800">
            <Row label="Source">{c.source}</Row>
            <Row label="PHP">{c.php}</Row>
            <Row label="Docroot"><Mono>{c.docroot}</Mono></Row>
            <Row label="Database">{c.db_name}</Row>
            <Row label="Node">{c.node.spec ? `${c.node.spec} (from ${c.node.source})` : 'none'}{c.build ? ' · builds a frontend' : ''}</Row>
            <Row label="Basic auth">{c.basic_auth ? 'on' : 'off'}</Row>
            <Row label="Hostnames">{list(c.hostnames)}</Row>
            <Row label="Custom domains">{list(c.custom_domains)}</Row>
            <Row label="Upload dirs">{list(c.upload_dirs)}</Row>
            <Row label="Persistent files">{list(c.persistent_files)}</Row>
            <Row label="Queue workers">{list(c.queue_workers)}</Row>
            <Row label="Schedule">{list(c.schedule.map((x) => x.replace('\t', '  ')))}</Row>
          </dl>
        )}
      </Card>
      <div className="space-y-4">
        <Card title="Operator overrides">
          <dl className="divide-y divide-stone-100 dark:divide-stone-800">
            <Row label="Tracked branch">{detail.deploy_branch ?? <span className="text-stone-400">repository default</span>}</Row>
            {detail.overrides && Object.keys(detail.overrides).length ? (
              Object.entries(detail.overrides).map(([k, v]) => <Row key={k} label={k}><Mono>{typeof v === 'string' ? v : JSON.stringify(v)}</Mono></Row>)
            ) : (
              <Row label="Overrides"><span className="text-stone-400">none (set with ddeploy override)</span></Row>
            )}
          </dl>
        </Card>
        <Card title={`Releases on disk (${detail.releases.length})`}>
          {detail.releases.length === 0 ? (
            <Empty>No releases (previews deploy in place).</Empty>
          ) : (
            <ul className="divide-y divide-stone-100 dark:divide-stone-800">
              {detail.releases.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                  <Mono>{r.id}</Mono>
                  {r.current && <Badge tone="ok">live</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
