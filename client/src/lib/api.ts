import type {
  BranchesResponse,
  CommitsResponse,
  DbCredentialsResponse,
  DbInfoResponse,
  UploadsResponse,
  BackupsResponse,
  WorkersResponse,
  SiteNamesResponse,
  ConfigFileResponse,
  ConfigFilesResponse,
  FetchKeyResponse,
  FetchSource,
  FetchTestResponse,
  GlobalOptions,
  Role,
  ServerConfigResponse,
  UserEntry,
  EnvChangeRequest,
  EnvEntry,
  SettingsRequest,
  AuditEntry,
  DoctorResponse,
  DoctorSnapshotResponse,
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

declare module '@tanstack/react-query' {
  interface Register {
    /** success: a toast once the mutation (and the refresh it waits for) succeeded. */
    mutationMeta: { success?: string | ((data: unknown, variables: unknown) => string) };
  }
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
  doctorSnapshot: (s: string) => ['doctorSnapshot', s] as const,
  logs: (s: string) => ['logs', s] as const,
  run: (s: string, id: string) => ['run', s, id] as const,
  runs: (s: string) => ['runs', s] as const,
  activity: ['activity'] as const,
  env: (s: string, n: string) => ['env', s, n] as const,
  db: (s: string, n: string) => ['db', s, n] as const,
  uploads: (s: string, n: string) => ['uploads', s, n] as const,
  backups: (s: string, n: string) => ['backups', s, n] as const,
  users: ['users'] as const,
  fetchKey: (s: string) => ['fetch-key', s] as const,
  configFiles: (s: string, n: string) => ['configFiles', s, n] as const,
  options: ['options'] as const,
  config: (s: string) => ['config', s] as const,
  branches: (s: string, n: string) => ['branches', s, n] as const,
  commits: (s: string, n: string, from: string, to: string) => ['commits', s, n, from, to] as const,
};

export const useMe = () =>
  useQuery({ queryKey: keys.me, queryFn: () => api<Me>('/api/me'), retry: false, staleTime: 5 * 60_000 });

export const useInfo = (server: string) =>
  useQuery({ queryKey: keys.info(server), queryFn: () => api<InfoResponse>(`${base(server)}/info`), staleTime: 5 * 60_000 });

/** Names only: instant, so lists and the site switcher don't wait for the full `sites`. */
export const useSiteNames = (server: string) =>
  useQuery({ queryKey: ['siteNames', server], queryFn: () => api<SiteNamesResponse>(`${base(server)}/site-names`), staleTime: 30_000 });

// `api sites` reads ddeploy's index (cheap), and /live says when a site
// changed (live.ts invalidates it): this interval is only a safety net.
export const useSites = (server: string) =>
  useQuery({ queryKey: keys.sites(server), queryFn: () => api<SitesResponse>(`${base(server)}/sites`), refetchInterval: 5 * 60_000 });

/** Bypasses the server's cache: for decisions (is this name taken?) rather than display. */
export const useFreshSites = (server: string) =>
  useQuery({ queryKey: [...keys.sites(server), 'fresh'], queryFn: () => api<SitesResponse>(`${base(server)}/sites?fresh=1`), staleTime: 0 });

/**
 * Homepage "Refresh": sites straight from ddeploy at once, then a full
 * health check (it takes a while); once that's stored, sites again, so
 * each site's health reflects it. Then the activity.
 */
export function useRefreshFleet(server: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      qc.setQueryData(keys.sites(server), await api<SitesResponse>(`${base(server)}/sites?fresh=1`));
      const doctor = await api<DoctorResponse>(`${base(server)}/doctor?fresh=1`);
      qc.setQueryData(keys.doctor(server), doctor);
      qc.setQueryData(keys.sites(server), await api<SitesResponse>(`${base(server)}/sites?fresh=1`));
      await qc.invalidateQueries({ queryKey: keys.doctorSnapshot(server) });
      await qc.invalidateQueries({ queryKey: keys.runs(server) });
    },
  });
}

/** Site page "Refresh": the site and its health fresh, then everything else about it (history, files, backups…). */
export function useRefreshSite(server: string, name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const [site, doctor] = await Promise.all([
        api<SiteDetailResponse>(`${base(server)}/sites/${name}?fresh=1`),
        api<DoctorResponse>(`${base(server)}/doctor?site=${name}&fresh=1`),
      ]);
      qc.setQueryData(keys.site(server, name), site);
      qc.setQueryData(keys.doctor(server, name), doctor);
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === server && q.queryKey.includes(name) && q.queryKey[0] !== 'site' && q.queryKey[0] !== 'doctor' });
    },
  });
}

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

/** Runs the checks (slow): the Status page and a site's Health tab. */
export const useDoctor = (server: string, site?: string, opts: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: keys.doctor(server, site),
    queryFn: () => api<DoctorResponse>(`${base(server)}/doctor${site ? `?site=${site}` : ''}`),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    enabled: opts.enabled ?? true,
  });

/** ddeploy's last scheduled check, nothing run (instant): summaries like the homepage's server card. */
export const useDoctorSnapshot = (server: string) =>
  useQuery({
    queryKey: keys.doctorSnapshot(server),
    queryFn: () => api<DoctorSnapshotResponse>(`${base(server)}/doctor?snapshot=1`),
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

export const useWorkers = (server: string, name: string) =>
  useQuery({
    queryKey: ['workers', server, name],
    queryFn: () => api<WorkersResponse>(`${base(server)}/sites/${name}/workers`),
    // A worker can crash between deploys: keep it reasonably current while the tab is open.
    refetchInterval: 15_000,
  });

export function useWorkerAction(server: string, name: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: (_: unknown, v: unknown) => { const { action, index } = v as { action: string; index: number }; return `Worker #${index} ${action === 'stop' ? 'stopped' : action === 'start' ? 'started' : 'restarted'}`; } },
    mutationFn: ({ index, action }: { index: number; action: 'restart' | 'stop' | 'start' }) =>
      api<WorkersResponse>(`${base(server)}/sites/${name}/workers/${index}/${action}`, { method: 'POST' }),
    onSuccess: (r) => qc.setQueryData(['workers', server, name], r),
  });
}

export function usePauseSchedules(server: string, name: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: (_: unknown, pause: unknown) => (pause ? 'Schedules paused — nothing runs until you resume' : 'Schedules resumed') },
    mutationFn: (pause: boolean) => api<WorkersResponse>(`${base(server)}/sites/${name}/schedules/${pause ? 'pause' : 'resume'}`, { method: 'POST' }),
    onSuccess: (r) => qc.setQueryData(['workers', server, name], r),
  });
}

export function useRunSchedule(server: string, name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (index: number) => api<{ run_id: string }>(`${base(server)}/sites/${name}/schedules/${index}/run`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.siteRuns(server, name) }),
  });
}

export const useConfigFiles = (server: string, name: string) =>
  useQuery({ queryKey: keys.configFiles(server, name), queryFn: () => api<ConfigFilesResponse>(`${base(server)}/sites/${name}/files`) });

/** Opens one file (recorded in the activity log: its content may hold credentials). */
export const useOpenConfigFile = (server: string, name: string) =>
  useMutation({
    mutationFn: (path: string) => api<ConfigFileResponse>(`${base(server)}/sites/${name}/files/read`, { method: 'POST', body: JSON.stringify({ path }) }),
  });

export function useSaveConfigFile(server: string, name: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: (_: unknown, v: unknown) => `Saved ${(v as { path: string }).path} — the site reads it on its next request` },
    mutationFn: (body: { path: string; content: string; expect_sha?: string }) =>
      api<{ changed: boolean; sha256: string }>(`${base(server)}/sites/${name}/files`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.configFiles(server, name) }),
  });
}

export function useRestoreConfigFile(server: string, name: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: (_: unknown, v: unknown) => `Restored ${(v as { path: string }).path}` },
    mutationFn: (body: { path: string; version: string }) =>
      api<{ changed: boolean; sha256: string }>(`${base(server)}/sites/${name}/files/restore`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.configFiles(server, name) }),
  });
}

export const useEnv = (server: string, name: string) =>
  useQuery({ queryKey: keys.env(server, name), queryFn: () => api<MaskedEnv>(`${base(server)}/sites/${name}/env`) });

export const revealEnv = (server: string, name: string, key: string) =>
  api<{ key: string; value: string }>(`${base(server)}/sites/${name}/env/reveal`, { method: 'POST', body: JSON.stringify({ key }) });

export function useApplyEnv(server: string, name: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: 'Environment saved — PHP reads it on the next request' },
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
    meta: { success: 'Settings saved — they apply on the next deploy' },
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
  useMutation({ meta: { success: 'Cancelling the run…' }, mutationFn: (id: string) => api<{ cancelled: boolean }>(`${base(server)}/runs/${id}/cancel`, { method: 'POST' }) });

export const useUploads = (server: string, name: string) =>
  useQuery({ queryKey: keys.uploads(server, name), queryFn: () => api<UploadsResponse>(`${base(server)}/sites/${name}/uploads`) });

export const uploadsDownloadUrl = (server: string, name: string, dir: string) =>
  `${base(server)}/sites/${name}/uploads/download?dir=${encodeURIComponent(dir)}`;

export const useBackups = (server: string, name: string) =>
  useQuery({ queryKey: keys.backups(server, name), queryFn: () => api<BackupsResponse>(`${base(server)}/sites/${name}/backups`), staleTime: 30_000 });

export const backupDownloadUrl = (server: string, name: string, file: string) =>
  `${base(server)}/sites/${name}/backups/download?file=${encodeURIComponent(file)}`;

export const useBackupNow = (server: string) => useStartRun(server, (site) => `/sites/${site}/backups/run`);
export const useBackupRestoreDb = (server: string) => useStartRun(server, (site) => `/sites/${site}/backups/restore-db`);
export const useBackupRestoreUploads = (server: string) => useStartRun(server, (site) => `/sites/${site}/backups/restore-uploads`);

export function useManageBackup(server: string, name: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: (_: unknown, v: unknown) => ({ keep: 'Backup kept — retention won’t delete it', unkeep: 'Backup no longer kept', delete: 'Backup deleted' })[(v as { action: 'keep' | 'unkeep' | 'delete' }).action] },
    mutationFn: ({ action, file }: { action: 'keep' | 'unkeep' | 'delete'; file: string }) =>
      api<{ file: string; action: string }>(`${base(server)}/sites/${name}/backups/${action}`, { method: 'POST', body: JSON.stringify({ file }) }),
    // Returned: the mutation (and its button) stays pending until the list no longer shows the old state.
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.backups(server, name) }),
  });
}

export const useUsers = () => useQuery({ queryKey: keys.users, queryFn: () => api<{ users: UserEntry[] }>('/api/admin/users') });

export function useSetUser() {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: (_: unknown, v: unknown) => `${(v as { email: string }).email}: role saved` },
    mutationFn: (u: { email: string; role: Role }) => api<{ users: UserEntry[] }>('/api/admin/users', { method: 'PUT', body: JSON.stringify(u) }),
    onSuccess: (r) => qc.setQueryData(keys.users, r),
  });
}

export function useRemoveUser() {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: (_: unknown, v: unknown) => `${v as string} no longer has access` },
    mutationFn: (email: string) => api<{ users: UserEntry[] }>(`/api/admin/users/${encodeURIComponent(email)}`, { method: 'DELETE' }),
    onSuccess: (r) => qc.setQueryData(keys.users, r),
  });
}

export const useOptions = () => useQuery({ queryKey: keys.options, queryFn: () => api<GlobalOptions>('/api/admin/options') });

export function useSetOptions() {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: 'Global options saved' },
    mutationFn: (o: Partial<GlobalOptions>) => api<GlobalOptions>('/api/admin/options', { method: 'PUT', body: JSON.stringify(o) }),
    onSuccess: (r) => qc.setQueryData(keys.options, r),
  });
}

export const useServerConfig = (server: string) =>
  useQuery({ queryKey: keys.config(server), queryFn: () => api<ServerConfigResponse>(`${base(server)}/config`) });

export function useSetServerConfig(server: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: (_: unknown, v: unknown) => `Server settings saved (${Object.keys(v as object).length})` },
    mutationFn: (set: Record<string, string>) => api<ServerConfigResponse>(`${base(server)}/config`, { method: 'PUT', body: JSON.stringify({ set }) }),
    onSuccess: (r) => {
      qc.setQueryData(keys.config(server), r);
      void qc.invalidateQueries({ queryKey: keys.info(server) });
    },
  });
}

export const useUploadsRestore = (server: string) => useStartRun(server, (site) => `/sites/${site}/uploads/restore`);
export const useUploadsSnapshot = (server: string) => useStartRun(server, (site) => `/sites/${site}/uploads/snapshot`);
export const useUploadsFetch = (server: string) => useStartRun(server, (site) => `/sites/${site}/uploads/fetch`);

export const useFetchKey = (server: string, enabled = true) =>
  useQuery({ queryKey: keys.fetchKey(server), queryFn: () => api<FetchKeyResponse>(`${base(server)}/fetch-key`), enabled, staleTime: 60_000 });

export function useFetchTest(server: string, name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { source: FetchSource; accept?: string }) =>
      api<FetchTestResponse>(`${base(server)}/sites/${name}/uploads/fetch-test`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (_, { accept }) => {
      if (accept) void qc.invalidateQueries({ queryKey: keys.fetchKey(server) });
    },
  });
}

export function useForgetHost(server: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: (_: unknown, v: unknown) => `Forgot ${(v as { host: string }).host}’s host key` },
    mutationFn: (body: { host: string; port: number }) => api<FetchKeyResponse>(`${base(server)}/fetch-key/forget`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (r) => qc.setQueryData(keys.fetchKey(server), r),
  });
}

/** POSTs a body (a File, or a tar Blob built from a folder) with upload progress; resolves with the run id. */
export function postWithProgress(url: string, body: Blob, headers: Record<string, string>, onProgress: (fraction: number) => void): Promise<{ run_id: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v.replace(/[^\x20-\x7e]/g, '_'));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let parsed: { run_id?: string; error?: { code: string; message: string } } | null = null;
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON: nginx's own error page (e.g. 413) */
      }
      if (xhr.status >= 200 && xhr.status < 300 && parsed?.run_id) resolve({ run_id: parsed.run_id });
      else if (xhr.status === 413) reject(new ApiError(413, 'too_large', 'the upload is larger than the server accepts (WEB_UPLOAD_MAX_MB)'));
      else reject(new ApiError(xhr.status, parsed?.error?.code ?? 'http_error', parsed?.error?.message ?? `upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'network', 'upload failed: network error'));
    xhr.send(body);
  });
}

export function uploadFiles(server: string, site: string, dir: string, mode: 'merge' | 'replace', body: Blob, label: string, fileCount: number, onProgress: (f: number) => void) {
  return postWithProgress(
    `${base(server)}/sites/${site}/uploads/import?dir=${encodeURIComponent(dir)}&mode=${mode}`,
    body,
    { 'x-filename': label, 'x-file-count': String(fileCount) },
    onProgress,
  );
}

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
