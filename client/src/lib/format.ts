export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : '—';
}

export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const s = Math.round((now.getTime() - t) / 1000);
  if (s < 0) return 'just now';
  if (s < 45) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(t).toISOString().slice(0, 10);
}

/** "Oct 2, 14:05" in local time ("Oct 2 2025, 14:05" outside the current year). */
export function dateTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date}, ${time}`;
}

export function duration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function bytes(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The forge's web page for a commit, from the git remote URL, for the
 * forges whose URL scheme is known; null otherwise (same idea as
 * ddeploy's commit_web_url).
 */
export function commitUrl(remote: string | null | undefined, sha: string | null | undefined): string | null {
  if (!remote || !sha) return null;
  const m =
    /^git@([^:]+):(.+?)(?:\.git)?\/?$/.exec(remote) ??
    /^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(remote) ??
    /^https:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(remote);
  if (!m) return null;
  const [, host, path] = m;
  if (host === 'github.com') return `https://github.com/${path}/commit/${sha}`;
  if (host === 'gitlab.com') return `https://gitlab.com/${path}/-/commit/${sha}`;
  if (host === 'bitbucket.org') return `https://bitbucket.org/${path}/commits/${sha}`;
  return null;
}

export const KIND_LABELS: Record<string, string> = {
  deploy: 'Deploy',
  rollback: 'Rollback',
  provision: 'Provision',
  'provision-preview': 'Preview created',
  'deploy-preview': 'Preview deploy',
  'remove-preview': 'Preview removed',
  'env-change': 'Environment changed',
  'settings-change': 'Settings changed',
  'db-import': 'Database imported',
  'db-restore': 'Database restored',
  'db-snapshot': 'Database snapshot',
  'uploads-import': 'Files uploaded',
  'uploads-restore': 'Files restored',
  'uploads-snapshot': 'Files snapshot',
};

export const kindLabel = (kind: string) => KIND_LABELS[kind] ?? (kind || 'Run');
