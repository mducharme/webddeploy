import type {
  BranchesResponse,
  CommitsResponse,
  DbCredentialsResponse,
  DbInfoResponse,
  EnvChangeRequest,
  EnvEntry,
  SettingsRequest,
  AuditEntry,
  DoctorResponse,
  InfoResponse,
  InspectRepoResponse,
  LogChunk,
  LogsResponse,
  Me,
  Preview,
  ProvisionRequest,
  Run,
  RunMeta,
  SiteDetailResponse,
  SitesResponse,
} from '@webddeploy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: Array<{ path: string; message: string }>;
  constructor(status: number, code: string, message: string, issues: Array<{ path: string; message: string }> = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string }; issues?: ApiError['issues'] } | null;
    throw new ApiError(res.status, body?.error?.code ?? 'http_error', body?.error?.message ?? res.statusText, body?.issues);
  }
  return (await res.json()) as T;
}

const base = (server: string) => `/api/servers/${encodeURIComponent(server)}`;

export const keys = {
  me: ['me'] as const,
  info: (s: string) => ['info', s] as const,
  sites: (s: string) => ['sites', s] as const,
  site: (s: string, n: string) => ['site', s, n] as const,
  siteRuns: (s: string, n: string) => ['siteRuns', s, n] as const,
  previews: (s: string, n: string) => ['previews', s, n] as const,
  doctor: (s: string, site?: string) => ['doctor', s, site ?? '*'] as const,
  logs: (s: string) => ['logs', s] as const,
  run: (s: string, id: string) => ['run', s, id] as const,
  runs: (s: string) => ['runs', s] as const,
  activity: ['activity'] as const,
  env: (s: string, n: string) => ['env', s, n] as const,
  db: (s: string, n: string) => ['db', s, n] as const,
  branches: (s: string, n: string) => ['branches', s, n] as const,
  commits: (s: string, n: string, from: string, to: string) => ['commits', s, n, from, to] as const,
};

export const useMe = () =>
  useQuery({ queryKey: keys.me, queryFn: () => api<Me>('/api/me'), retry: false, staleTime: 5 * 60_000 });

export const useInfo = (server: string) =>
  useQuery({ queryKey: keys.info(server), queryFn: () => api<InfoResponse>(`${base(server)}/info`), staleTime: 5 * 60_000 });

export const useSites = (server: string) =>
  useQuery({ queryKey: keys.sites(server), queryFn: () => api<SitesResponse>(`${base(server)}/sites`), refetchInterval: 30_000 });

/** Bypasses the server's cache: for decisions (is this name taken?) rather than display. */
export const useFreshSites = (server: string) =>
  useQuery({ queryKey: [...keys.sites(server), 'fresh'], queryFn: () => api<SitesResponse>(`${base(server)}/sites?fresh=1`), staleTime: 0 });

export const useSite = (server: string, name: string) =>
  useQuery({ queryKey: keys.site(server, name), queryFn: () => api<SiteDetailResponse>(`${base(server)}/sites/${name}`), enabled: !!name });

export const useSiteRuns = (server: string, name: string) =>
  useQuery({
    queryKey: keys.siteRuns(server, name),
    queryFn: () => api<{ runs: Run[] }>(`${base(server)}/sites/${name}/runs`),
    refetchInterval: 15_000,
  });

export const usePreviews = (server: string, name: string) =>
  useQuery({
    queryKey: keys.previews(server, name),
    queryFn: () => api<{ active: Preview[]; history: Run[] }>(`${base(server)}/sites/${name}/previews`),
  });

export const useDoctor = (server: string, site?: string) =>
  useQuery({
    queryKey: keys.doctor(server, site),
    queryFn: () => api<DoctorResponse>(`${base(server)}/doctor${site ? `?site=${site}` : ''}`),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

export const useLogs = (server: string) =>
  useQuery({ queryKey: keys.logs(server), queryFn: () => api<LogsResponse>(`${base(server)}/logs`) });

export const useRun = (server: string, id: string) =>
  useQuery({
    queryKey: keys.run(server, id),
    queryFn: () => api<{ run: Run; meta: RunMeta | null; log_size: number | null }>(`${base(server)}/runs/${id}`),
  });

export const useRecentRuns = (server: string, limit = 15) =>
  useQuery({
    queryKey: [...keys.runs(server), limit],
    queryFn: () => api<{ runs: Run[] }>(`${base(server)}/runs?limit=${limit}`),
    refetchInterval: 15_000,
  });

export const useActivity = () =>
  useQuery({ queryKey: keys.activity, queryFn: () => api<{ entries: AuditEntry[] }>('/api/activity?limit=200') });

export function useDeploy(server: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (site: string) => api<{ run_id: string }>(`${base(server)}/sites/${site}/deploy`, { method: 'POST' }),
    onSuccess: (_, site) => {
      void qc.invalidateQueries({ queryKey: keys.sites(server) });
      void qc.invalidateQueries({ queryKey: keys.siteRuns(server, site) });
    },
  });
}

export const useInspectRepo = (server: string) =>
  useMutation({
    mutationFn: (body: { repo_url: string; branch?: string | null }) =>
      api<InspectRepoResponse>(`${base(server)}/provision/inspect`, { method: 'POST', body: JSON.stringify(body) }),
  });

export function useProvision(server: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: ProvisionRequest) => api<{ run_id: string }>(`${base(server)}/provision`, { method: 'POST', body: JSON.stringify(req) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.sites(server) }),
  });
}

export type MaskedEnvEntry = EnvEntry & { masked: boolean; length: number };
export interface MaskedEnv {
  path: string;
  entries: MaskedEnvEntry[];
  unparsed_lines: number;
}

export const useEnv = (server: string, name: string) =>
  useQuery({ queryKey: keys.env(server, name), queryFn: () => api<MaskedEnv>(`${base(server)}/sites/${name}/env`) });

export const revealEnv = (server: string, name: string, key: string) =>
  api<{ key: string; value: string }>(`${base(server)}/sites/${name}/env/reveal`, { method: 'POST', body: JSON.stringify({ key }) });

export function useApplyEnv(server: string, name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: EnvChangeRequest) => api<MaskedEnv>(`${base(server)}/sites/${name}/env`, { method: 'PUT', body: JSON.stringify(req) }),
    onSuccess: (env) => {
      qc.setQueryData(keys.env(server, name), env);
      void qc.invalidateQueries({ queryKey: keys.siteRuns(server, name) });
    },
  });
}

export function useApplySettings(server: string, name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: SettingsRequest) => api<SiteDetailResponse>(`${base(server)}/sites/${name}/settings`, { method: 'PUT', body: JSON.stringify(req) }),
    onSuccess: (detail) => {
      qc.setQueryData(keys.site(server, name), detail);
      void qc.invalidateQueries({ queryKey: keys.siteRuns(server, name) });
    },
  });
}

export const useBranches = (server: string, name: string, enabled = true) =>
  useQuery({ queryKey: keys.branches(server, name), queryFn: () => api<BranchesResponse>(`${base(server)}/sites/${name}/branches`), enabled, staleTime: 60_000 });

export const useCommits = (server: string, name: string, from: string | null, to: string | null) =>
  useQuery({
    queryKey: keys.commits(server, name, from ?? '', to ?? ''),
    queryFn: () => api<CommitsResponse>(`${base(server)}/sites/${name}/commits?from=${from}&to=${to}`),
    enabled: !!name && !!from && !!to && from !== to,
    staleTime: Infinity,
  });

export const useDbInfo = (server: string, name: string, enabled = true) =>
  useQuery({ queryKey: keys.db(server, name), queryFn: () => api<DbInfoResponse>(`${base(server)}/sites/${name}/db`), enabled });

export const fetchDbCredentials = (server: string, name: string) =>
  api<DbCredentialsResponse>(`${base(server)}/sites/${name}/db/credentials`, { method: 'POST' });

export const dbDumpUrl = (server: string, name: string, snapshot?: string) =>
  `${base(server)}/sites/${name}/db/dump${snapshot ? `?snapshot=${snapshot}` : ''}`;

/** A run-starting POST: resolves with the new run's id. */
export function useStartRun(server: string, path: (site: string) => string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ site, body }: { site: string; body?: unknown }) =>
      api<{ run_id: string }>(`${base(server)}${path(site)}`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
    onSuccess: (_, { site }) => {
      void qc.invalidateQueries({ queryKey: keys.siteRuns(server, site) });
      void qc.invalidateQueries({ queryKey: keys.sites(server) });
    },
  });
}

/** Preview runs are started on the project; their own site name comes back with the run id. */
export function usePreviewRun(server: string, action: 'create' | 'deploy' | 'remove') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ project, body }: { project: string; body: unknown }) =>
      api<{ run_id: string; site: string | null }>(`${base(server)}/sites/${project}/previews${action === 'create' ? '' : `/${action}`}`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (_, { project }) => {
      void qc.invalidateQueries({ queryKey: keys.previews(server, project) });
      void qc.invalidateQueries({ queryKey: keys.sites(server) });
    },
  });
}

export const useRollback = (server: string) => useStartRun(server, (site) => `/sites/${site}/rollback`);
export const useDbRestore = (server: string) => useStartRun(server, (site) => `/sites/${site}/db/restore`);
export const useDbSnapshot = (server: string) => useStartRun(server, (site) => `/sites/${site}/db/snapshot`);

export const useCancelRun = (server: string) =>
  useMutation({ mutationFn: (id: string) => api<{ cancelled: boolean }>(`${base(server)}/runs/${id}/cancel`, { method: 'POST' }) });

/**
 * Uploads a dump for import. XHR rather than fetch, for upload progress;
 * the body is the raw file (the server streams it to ddeploy's stdin).
 */
export function uploadDump(server: string, site: string, file: File, onProgress: (fraction: number) => void): Promise<{ run_id: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${base(server)}/sites/${site}/db/import`);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.setRequestHeader('x-filename', file.name.replace(/[^\x20-\x7e]/g, '_'));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      const body = (() => {
        try {
          return JSON.parse(xhr.responseText) as { run_id?: string; error?: { code: string; message: string } };
        } catch {
          return null;
        }
      })();
      if (xhr.status >= 200 && xhr.status < 300 && body?.run_id) resolve({ run_id: body.run_id });
      else reject(new ApiError(xhr.status, body?.error?.code ?? 'http_error', body?.error?.message ?? `upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'network', 'upload failed: network error'));
    xhr.send(file);
  });
}

export const logStreamUrl = (server: string, name: string, lines = 300) => `${base(server)}/logs/${name}/stream?lines=${lines}`;
export const runStreamUrl = (server: string, id: string) => `${base(server)}/runs/${id}/stream`;

export async function signOut(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
  window.location.assign('/');
}

export type { LogChunk };
