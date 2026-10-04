// Schemas for what `ddeploy api <verb>` prints (ddeploy's lib/cmd_api.sh).
// Field names are kept exactly as ddeploy emits them (snake_case) all the
// way to the browser: one shape per concept, no mapping layer to drift.
//
// Unknown keys are stripped rather than rejected, so a newer ddeploy that
// adds fields keeps working; a removed or retyped field fails parsing,
// which the server reports as an incompatible ddeploy version.
import { z } from 'zod';

export const SUPPORTED_API_VERSION = 1;

const nullableString = z.string().nullable();

export const eventPhase = z.enum(['started', 'succeeded', 'failed', 'skipped']);
export type EventPhase = z.infer<typeof eventPhase>;

export const ddeployEvent = z.object({
  ts: z.string(),
  run_id: nullableString,
  site: z.string(),
  // deploy | rollback | provision | provision-preview | deploy-preview | remove-preview
  kind: z.string(),
  phase: eventPhase,
  trigger: z.string(),
  from_sha: z.string().optional(),
  to_sha: z.string().optional(),
  subject: z.string().optional(),
  /** The deployed commit's git author. */
  author: z.string().optional(),
  branch: z.string().optional(),
  project: z.string().optional(),
  duration_s: z.number().optional(),
  error: z.string().optional(),
});
export type DdeployEvent = z.infer<typeof ddeployEvent>;

const versioned = { api_version: z.number().int() };

export const infoResponse = z.object({
  ...versioned,
  hostname: z.string(),
  ddeploy: z.object({ sha: nullableString, branch: nullableString }),
  base_domain: z.string(),
  php: z.object({ default: z.string(), baseline: z.array(z.string()), installed: z.array(z.string()) }),
  node: z.object({ enabled: z.boolean(), default: z.string() }),
  features: z.object({
    webhook: z.boolean(),
    backups: z.boolean(),
    db_backups: z.boolean(),
    preview_prune: z.boolean(),
    web: z.boolean(),
  }),
  preview_db_mode: z.string(),
  basic_auth_default: z.boolean(),
  defaults: z
    .object({ client_max_body_size: z.string(), fpm_max_children: z.string(), db_backup_retention_days: z.string() })
    .optional(),
  limits: z.object({ db_import_max_bytes: z.number(), uploads_import_max_bytes: z.number().optional() }).optional(),
  backups: z
    .object({
      bucket: nullableString,
      database: z.object({ enabled: z.boolean(), schedule: z.string(), retention_days: z.number().nullable() }),
      uploads: z.object({ enabled: z.boolean(), schedule: z.string(), versions_days: z.number().nullable() }),
    })
    .optional(),
});
export type InfoResponse = z.infer<typeof infoResponse>;

export const previewRef = z.object({ project: z.string(), branch: z.string(), mode: z.string() });

export const siteSummary = z.object({
  name: z.string(),
  url: z.string(),
  php: nullableString,
  node: nullableString,
  build: z.boolean(),
  docroot: z.string(),
  db: nullableString,
  branch: nullableString,
  sha: nullableString,
  committed_at: nullableString,
  subject: nullableString,
  repo: nullableString,
  preview: previewRef.nullable(),
  last_event: ddeployEvent.nullable(),
  /** Newest run that isn't a config change. */
  last_run: ddeployEvent.nullable().optional(),
  /** Newest successful deploy/rollback/provision (or preview deploy). */
  last_deploy: ddeployEvent.nullable().optional(),
  /** When the live code went live. */
  deployed_at: nullableString.optional(),
  last_backups: z.object({ database: ddeployEvent.nullable(), uploads: ddeployEvent.nullable() }).optional(),
});
export type SiteSummary = z.infer<typeof siteSummary>;

export const sitesResponse = z.object({
  ...versioned,
  base_domain: z.string(),
  sites: z.array(siteSummary),
});
export type SitesResponse = z.infer<typeof sitesResponse>;

export const siteConfig = z.object({
  source: z.string(),
  php: nullableString,
  docroot: z.string(),
  db_name: nullableString,
  hostnames: z.array(z.string()),
  custom_domains: z.array(z.string()),
  upload_dirs: z.array(z.string()),
  persistent_files: z.array(z.string()),
  basic_auth: z.boolean().nullable(),
  node: z.object({ spec: nullableString, source: nullableString }),
  build: z.boolean().nullable(),
  queue_workers: z.array(z.string()),
  schedule: z.array(z.string()),
  /** Effective values of what `api settings` can override (absent from ddeploy before phase 2). */
  settings: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
});
export type SiteConfig = z.infer<typeof siteConfig>;

export const release = z.object({ id: z.string(), sha: nullableString, current: z.boolean() });
export type Release = z.infer<typeof release>;

export const legacyDeploy = z.object({ ts: z.string(), sha: z.string() });
export type LegacyDeploy = z.infer<typeof legacyDeploy>;

export const siteDetailResponse = z.object({
  ...versioned,
  site: siteSummary,
  config: siteConfig.nullable(),
  config_error: nullableString,
  overrides: z.record(z.string(), z.unknown()).nullable(),
  deploy_branch: nullableString,
  releases: z.array(release),
  legacy_deploys: z.array(legacyDeploy),
  previews: z.array(z.string()),
});
export type SiteDetailResponse = z.infer<typeof siteDetailResponse>;

export const eventsResponse = z.object({ ...versioned, events: z.array(ddeployEvent) });
export type EventsResponse = z.infer<typeof eventsResponse>;

export const preview = z.object({
  name: z.string(),
  url: z.string(),
  branch: z.string(),
  mode: z.string(),
  provisioned: z.boolean(),
  sha: nullableString,
  committed_at: nullableString,
  subject: nullableString,
  deployed_sha: nullableString,
});
export type Preview = z.infer<typeof preview>;

export const previewsResponse = z.object({ ...versioned, project: z.string(), previews: z.array(preview) });
export type PreviewsResponse = z.infer<typeof previewsResponse>;

export const checkStatus = z.enum(['ok', 'warn', 'fail', 'off']);
export type CheckStatus = z.infer<typeof checkStatus>;

export const doctorCheck = z.object({ status: checkStatus, check: z.string(), detail: z.string() });
export type DoctorCheck = z.infer<typeof doctorCheck>;

export const doctorSite = z.object({
  name: z.string(),
  worst: checkStatus,
  preview: z.object({ project: z.string(), mode: z.string() }).nullable(),
  checks: z.array(doctorCheck),
});
export type DoctorSite = z.infer<typeof doctorSite>;

export const doctorResponse = z.object({
  ...versioned,
  checked_at: z.string(),
  server: z.object({ worst: checkStatus, checks: z.array(doctorCheck) }),
  sites: z.array(doctorSite),
});
export type DoctorResponse = z.infer<typeof doctorResponse>;

export const logInfo = z.object({
  name: z.string(),
  /** site (ddeploy's own) | nginx (per-site web server) | server (nginx/PHP-FPM) | webhook | fleet */
  kind: z.string(),
  site: nullableString.optional(),
  label: z.string().optional(),
  size: z.number().nullable(),
  modified_at: z.string(),
});
export type LogInfo = z.infer<typeof logInfo>;

export const logsResponse = z.object({ ...versioned, logs: z.array(logInfo) });
export type LogsResponse = z.infer<typeof logsResponse>;

export const logChunk = z.object({
  ...versioned,
  name: z.string().optional(),
  run_id: z.string().optional(),
  size: z.number(),
  offset: z.number(),
  next_offset: z.number(),
  rotated: z.boolean(),
  text: z.string(),
});
export type LogChunk = z.infer<typeof logChunk>;

export const inspectRepoResponse = z.object({
  ...versioned,
  url: z.string(),
  reachable: z.boolean(),
  error: z.string().optional(),
  default_branch: nullableString.optional(),
  branches: z.array(z.string()).optional(),
  branch: nullableString.optional(),
  detected: z
    .object({
      ddev: z
        .object({
          name: nullableString,
          php_version: nullableString,
          docroot: nullableString,
          nodejs_version: nullableString,
        })
        .nullable(),
      ddeploy_config: z.boolean(),
      cms: nullableString,
      cms_docroot: nullableString,
      package_json: z.boolean(),
      nvmrc: nullableString,
      composer_json: z.boolean(),
    })
    .nullable()
    .optional(),
  requires: z.object({ php: z.boolean() }).optional(),
});
export type InspectRepoResponse = z.infer<typeof inspectRepoResponse>;

export const runStartResponse = z.object({ ...versioned, run_id: z.string(), site: z.string().optional() });

export const runMeta = z.object({
  run_id: z.string(),
  kind: z.string(),
  site: z.string(),
  argv: z.array(z.string()),
  actor: z.string(),
  submitted_at: z.string(),
});
export type RunMeta = z.infer<typeof runMeta>;

export const runShowResponse = z.object({
  ...versioned,
  run_id: z.string(),
  meta: runMeta.nullable(),
  events: z.array(ddeployEvent),
  unit: z.object({ load_state: nullableString, active_state: nullableString, result: nullableString }),
  log_size: z.number().nullable(),
  cancelled_by: nullableString.optional(),
});
export type RunShowResponse = z.infer<typeof runShowResponse>;

/** `api files <name>`: persistent config files the editor can open (not .env). */
export const configFilesResponse = z.object({
  api_version: z.number(),
  site: z.string(),
  target: z.string(),
  /** The DB credential file's path for this site's scheme (".env", "config/config.local.json", or ""). */
  credential: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      format: z.enum(['json', 'yaml', 'php', 'env', 'ini', 'text']),
      exists: z.boolean(),
      size: z.number().nullable(),
      credential: z.boolean(),
    }),
  ),
});
export type ConfigFilesResponse = z.infer<typeof configFilesResponse>;

export const configFileResponse = z.object({
  api_version: z.number(),
  path: z.string(),
  format: z.enum(['json', 'yaml', 'php', 'env', 'ini', 'text']),
  exists: z.boolean(),
  size: z.number(),
  sha256: z.string(),
  content: z.string(),
  versions: z.array(z.object({ id: z.string(), size: z.number(), by: z.string() })),
});
export type ConfigFileResponse = z.infer<typeof configFileResponse>;

export const configFileWriteResponse = z.object({ api_version: z.number(), path: z.string(), changed: z.boolean(), sha256: z.string() });

export const envEntry = z.object({ key: z.string(), value: z.string(), managed: z.boolean() });
export type EnvEntry = z.infer<typeof envEntry>;

export const envResponse = z.object({
  ...versioned,
  path: z.string(),
  entries: z.array(envEntry),
  unparsed_lines: z.number(),
});
export type EnvResponse = z.infer<typeof envResponse>;

export const dbSnapshot = z.object({ id: z.string(), bytes: z.number().nullable(), reason: z.string(), created_at: z.string() });
export type DbSnapshot = z.infer<typeof dbSnapshot>;

export const dbInfoResponse = z.object({
  ...versioned,
  site: z.string(),
  /** The site whose database this is: a shared-mode preview's parent. */
  target: z.string(),
  database: z.string(),
  user: z.string(),
  host: z.string(),
  scheme: z.string(),
  error: nullableString,
  size_bytes: z.number().nullable(),
  table_count: z.number().nullable(),
  tables: z.array(z.object({ name: z.string(), rows: z.number().nullable(), bytes: z.number().nullable() })),
  snapshots: z.array(dbSnapshot),
});
export type DbInfoResponse = z.infer<typeof dbInfoResponse>;

export const dbCredentialsResponse = z.object({
  ...versioned,
  host: z.string(),
  port: z.number(),
  database: z.string(),
  user: z.string(),
  password: z.string(),
});
export type DbCredentialsResponse = z.infer<typeof dbCredentialsResponse>;

export const branchesResponse = z.object({
  ...versioned,
  default_branch: nullableString,
  tracked: nullableString,
  branches: z.array(z.string()),
});
export type BranchesResponse = z.infer<typeof branchesResponse>;

export const commit = z.object({ sha: z.string(), author: z.string(), date: z.string(), subject: z.string() });
export type Commit = z.infer<typeof commit>;

export const commitsResponse = z.object({
  ...versioned,
  from: z.string(),
  to: z.string(),
  known: z.boolean(),
  ahead: z.array(commit),
  behind: z.array(commit),
});
export type CommitsResponse = z.infer<typeof commitsResponse>;

export const uploadsResponse = z.object({
  ...versioned,
  site: z.string(),
  /** The site whose files these are: a shared-mode preview's parent. */
  target: z.string(),
  dirs: z.array(
    z.object({
      dir: z.string(),
      path: z.string(),
      exists: z.boolean(),
      /** null: still counting after 10s (a very large folder). */
      files: z.number().nullable(),
      bytes: z.number().nullable(),
    }),
  ),
  snapshots: z.array(z.object({ id: z.string(), dir: z.string(), reason: z.string(), created_at: z.string() })),
  max_bytes: z.number(),
});
export type UploadsResponse = z.infer<typeof uploadsResponse>;

/** `api fetch-key`: the key "Copy from another server" logs in with. */
export const fetchKeyResponse = z.object({
  api_version: z.number(),
  public_key: z.string(),
  authorized_keys: z.string(),
  server_ip: z.string(),
  rsync: z.boolean(),
  known_hosts: z.array(z.object({ host: z.string(), type: z.string(), fingerprint: z.string() })),
});
export type FetchKeyResponse = z.infer<typeof fetchKeyResponse>;

/** `api fetch-test`: the host key's state, then (when confirmed) a dry run. */
export const fetchTestResponse = z.object({
  api_version: z.number(),
  host: z.string(),
  port: z.number(),
  host_key: z.object({
    status: z.enum(['known', 'unknown', 'changed', 'unreachable']),
    fingerprints: z.array(z.object({ type: z.string(), fingerprint: z.string() })),
  }),
  files: z.number().nullable(),
  bytes: z.number().nullable(),
  error: z.string().nullable(),
});
export type FetchTestResponse = z.infer<typeof fetchTestResponse>;

export const backupDump = z.object({ file: z.string(), bytes: z.number().nullable(), created_at: nullableString, kept: z.boolean() });
export type BackupDump = z.infer<typeof backupDump>;

export const backupsResponse = z.object({
  ...versioned,
  site: z.string(),
  /** The site whose backups these are: a shared-mode preview's parent. */
  target: z.string(),
  shared_with_parent: z.boolean(),
  configured: z.boolean(),
  bucket: nullableString,
  error: nullableString,
  database: z.object({
    enabled: z.boolean(),
    schedule: z.string(),
    retention_days: z.number().nullable(),
    retention_source: z.enum(['site', 'server']),
    dumps: z.array(backupDump),
    last_run: ddeployEvent.nullable(),
  }),
  uploads: z.object({
    enabled: z.boolean(),
    schedule: z.string(),
    versions_days: z.number().nullable(),
    mirror: z.array(z.object({ dir: z.string(), files: z.number().nullable(), bytes: z.number().nullable() })),
    versions: z.array(z.object({ id: z.string(), created_at: z.string(), dirs: z.array(z.string()) })),
    last_run: ddeployEvent.nullable(),
  }),
});
export type BackupsResponse = z.infer<typeof backupsResponse>;

export const runCancelResponse = z.object({ ...versioned, run_id: z.string(), cancelled: z.boolean() });

export const apiErrorResponse = z.object({
  ...versioned,
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponse>;

// Validation rules ddeploy itself enforces (lib/common.sh, lib/config.sh,
// lib/cmd_api.sh), mirrored so forms can say what's wrong before a round
// trip. ddeploy stays the authority: these only ever reject earlier.
export const patterns = {
  siteName: /^[a-z0-9][a-z0-9-]{0,27}$/,
  repoUrl: /^(ssh:\/\/|https:\/\/|git@)[A-Za-z0-9._~:/@%+-]+$/,
  branch: /^[A-Za-z0-9][A-Za-z0-9._/-]*$/,
  php: /^[0-9]+\.[0-9]+$/,
  dbIdentifier: /^[A-Za-z0-9_][A-Za-z0-9_-]*$/,
  hostname:
    /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
  uploadDir: /^[A-Za-z0-9._/-]+$/,
  node: /^(v?[0-9]+(\.[0-9]+){0,2}|lts\/(\*|[a-z]+)|lts|node)$/,
  runId: /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{6}$/,
  /** ddeploy log names: <site>, <site>.access|error, nginx_access|error, phpX.Y_fpm (lib/cmd_api.sh API_LOG_NAME_RE). */
  logName: /^([a-z0-9][a-z0-9-]{0,27}(\.(access|error))?|nginx_(access|error)|php[0-9]\.[0-9]{1,2}_fpm)$/,
  snapshotId: /^[0-9]{8}T[0-9]{6}Z-[a-z][a-z-]{0,19}$/,
  uploadsSnapshotId: /^[0-9]{8}T[0-9]{6}Z-[a-z0-9-]{1,40}$/,
  backupDump: /^[A-Za-z0-9][A-Za-z0-9_.-]{0,200}\.sql(\.gz)?$/,
  uploadsVersion: /^[0-9]{8}T[0-9]{6}Z$/,
  sha: /^[0-9a-f]{7,40}$/,
  envKey: /^[A-Za-z_][A-Za-z0-9_]*$/,
  /** A persistent file's repo-relative path (lib/config.sh validate_relative_path). */
  configFile: /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[A-Za-z0-9._/@+-]{1,300}$/,
  fileVersion: /^[0-9]{8}T[0-9]{6}Z$/,
  /** lib/cmd_fetch.sh FETCH_USER_RE / FETCH_PATH_RE. */
  sshUser: /^[a-z_][a-z0-9_.-]{0,31}$/,
  sshPath: /^[A-Za-z0-9._/@+~-]*$/,
  fingerprint: /^SHA256:[A-Za-z0-9+/=]{20,80}$/,
} as const;
