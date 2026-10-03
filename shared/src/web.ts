// Types of webddeploy's own HTTP API (server <-> browser), on top of the
// ddeploy payloads in ddeploy.ts.
import { z } from 'zod';
import { patterns, type CheckStatus, type DoctorResponse } from './ddeploy.ts';

export interface ServerRef {
  id: string;
  name: string;
}

export const ROLES = ['viewer', 'admin', 'superadmin'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = { viewer: 'Viewer', admin: 'Admin', superadmin: 'Super-admin' };

export function roleAtLeast(role: Role | null | undefined, needed: Role): boolean {
  if (!role) return false;
  return ROLES.indexOf(role) >= ROLES.indexOf(needed);
}

export interface Me {
  email: string;
  name: string | null;
  picture: string | null;
  role: Role;
  servers: ServerRef[];
}

export interface UserEntry {
  email: string;
  role: Role;
  /** config: from the env file (fixed here); ui: added by a super-admin. */
  source: 'config' | 'ui';
  added_by: string | null;
  added_at: string | null;
  last_seen_at: string | null;
}

export interface GlobalOptions {
  /** viewer: anyone signed in from an allowed Workspace domain can look; none: only listed users. */
  domain_default_role: 'none' | 'viewer';
  /** GOOGLE_ALLOWED_DOMAINS, for display (read-only). */
  allowed_domains?: string[];
}

export const userRequest = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  role: z.enum(ROLES),
});

export const optionsRequest = z.object({ domain_default_role: z.enum(['none', 'viewer']).optional() });

export interface AuditEntry {
  id: number;
  at: string;
  email: string;
  server_id: string;
  action: string;
  target: string | null;
  detail: unknown;
  run_id: string | null;
  outcome: 'requested' | 'ok' | 'rejected';
  error: string | null;
}

export interface ApiError {
  error: { code: string; message: string };
}

const list = (re: RegExp, label: string) =>
  z
    .array(z.string().trim().min(1))
    .max(20)
    .refine((xs) => xs.every((x) => re.test(x)), { message: `invalid ${label}` });

const optional = (re: RegExp, message: string) =>
  z
    .string()
    .trim()
    .transform((s) => s || null)
    .nullable()
    .optional()
    .refine((s) => s == null || re.test(s), { message });

/** POST /provision body. Mirrors the flags `ddeploy api run start provision` accepts. */
export const provisionRequest = z.object({
  name: z.string().trim().regex(patterns.siteName, 'lowercase letters, digits and -, up to 28 characters'),
  repo_url: z
    .string()
    .trim()
    .regex(patterns.repoUrl, 'an ssh://, git@ or https:// URL')
    .refine((u) => !/(:\/\/|@)-/.test(u), 'the host cannot start with -'),
  branch: optional(patterns.branch, 'not a plain branch name').refine(
    (b) => b == null || !`/${b}/`.includes('/../'),
    'not a plain branch name',
  ),
  php: optional(patterns.php, 'a PHP version like 8.3'),
  docroot: optional(/^[^/\n][^\n]*$/, 'a path relative to the repository root').refine(
    (d) => d == null || !`/${d}/`.includes('/../'),
    'cannot contain ..',
  ),
  db: optional(patterns.dbIdentifier, 'letters, digits, _ and -'),
  hostnames: list(patterns.hostname, 'hostname').default([]),
  custom_domains: list(patterns.hostname, 'domain').default([]),
  upload_dirs: list(patterns.uploadDir, 'directory')
    .refine((xs) => xs.every((x) => !x.startsWith('/')), 'relative paths only')
    .default([]),
  auth: z.boolean().nullable().default(null),
  node: optional(patterns.node, 'a Node version like 22, 22.11.0 or lts/*'),
  build: z.boolean().nullable().default(null),
});
export type ProvisionRequest = z.input<typeof provisionRequest>;
export type ProvisionRequestParsed = z.output<typeof provisionRequest>;

/** The flags after `<name> <repo-url>`, as ddeploy expects them. */
export function provisionFlags(req: ProvisionRequestParsed): string[] {
  const flags: string[] = [];
  if (req.branch) flags.push('--branch', req.branch);
  if (req.php) flags.push('--php', req.php);
  if (req.docroot) flags.push('--docroot', req.docroot);
  if (req.db) flags.push('--db', req.db);
  if (req.hostnames.length) flags.push('--hostnames', req.hostnames.join(' '));
  if (req.custom_domains.length) flags.push('--custom-domains', req.custom_domains.join(' '));
  if (req.upload_dirs.length) flags.push('--upload-dirs', req.upload_dirs.join(' '));
  if (req.auth === true) flags.push('--auth');
  if (req.auth === false) flags.push('--no-auth');
  if (req.node) flags.push('--node', req.node);
  if (req.build === true) flags.push('--build');
  if (req.build === false) flags.push('--no-build');
  return flags;
}

function shellQuote(s: string): string {
  return /^[A-Za-z0-9._~:/@%+=,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** The CLI command an operator would type for the same provision. */
export function provisionCliCommand(req: ProvisionRequestParsed): string {
  return ['ddeploy', 'provision', req.name, req.repo_url, '--non-interactive', ...provisionFlags(req)]
    .map(shellQuote)
    .join(' ');
}

export interface StatusCounts {
  ok: number;
  warn: number;
  fail: number;
  off: number;
}

export function countStatuses(doctor: DoctorResponse): StatusCounts {
  const counts: StatusCounts = { ok: 0, warn: 0, fail: 0, off: 0 };
  for (const c of doctor.server.checks) counts[c.status]++;
  for (const s of doctor.sites) for (const c of s.checks) counts[c.status]++;
  return counts;
}

const severity: Record<CheckStatus, number> = { off: 0, ok: 1, warn: 2, fail: 3 };

export function worstOf(statuses: Iterable<CheckStatus>): CheckStatus {
  let worst: CheckStatus = 'ok';
  for (const s of statuses) if (severity[s] > severity[worst]) worst = s;
  return worst;
}

/** POST .../previews: a branch preview of a project. */
export const previewCreateRequest = z.object({
  branch: z
    .string()
    .trim()
    .regex(patterns.branch, 'not a plain branch name')
    .refine((b) => !`/${b}/`.includes('/../'), 'not a plain branch name'),
  /** shared: the project's database and uploads; isolated: its own copy. Absent: the server default (PREVIEW_DB_MODE). */
  mode: z.enum(['shared', 'isolated']).nullable().default(null),
  /** Isolated only: seed the copy from the project at creation (ddeploy default: yes). */
  seed: z.boolean().default(true),
  /** Basic auth; previews default to on. */
  auth: z.boolean().nullable().default(null),
});
export type PreviewCreateRequest = z.input<typeof previewCreateRequest>;

export const previewBranchRequest = z.object({ branch: previewCreateRequest.shape.branch });

/** The flags after `--branch <b>` for `api run start preview-create`. */
export function previewCreateFlags(req: z.output<typeof previewCreateRequest>): string[] {
  const flags: string[] = [];
  if (req.mode === 'shared') flags.push('--shared');
  if (req.mode === 'isolated') flags.push('--isolated');
  if (req.mode !== 'shared' && !req.seed) flags.push('--no-seed');
  if (req.auth === true) flags.push('--auth');
  if (req.auth === false) flags.push('--no-auth');
  return flags;
}

// --- copy from another server (uploads-fetch) ------------------------------

/** Where to copy from. ddeploy re-validates all of it (lib/cmd_fetch.sh). */
export const fetchSource = z.object({
  user: z.string().trim().regex(patterns.sshUser, 'a login like deploy or www-data'),
  host: z
    .string()
    .trim()
    .regex(patterns.hostname, 'a hostname or IPv4 address')
    .refine((h) => !h.startsWith('-'), 'invalid host'),
  port: z.coerce.number().int().min(1).max(65535).default(22),
  path: z
    .string()
    .trim()
    .max(400)
    .regex(patterns.sshPath, 'letters, digits and . _ / @ + ~ - only')
    .refine((p) => !p.startsWith('-'), "can't start with -")
    .refine((p) => !`/${p}/`.includes('/../'), "can't contain ..")
    .default(''),
});
export type FetchSource = z.input<typeof fetchSource>;

/** user@host:path, as ddeploy takes it (--source). */
export function sourceSpec(s: { user: string; host: string; path?: string }): string {
  return `${s.user}@${s.host}:${s.path ?? ''}`;
}

export const fetchTestRequest = z.object({
  source: fetchSource,
  /** The fingerprint the admin confirmed; must match what the host presents now. */
  accept: z.string().regex(patterns.fingerprint).optional(),
});

export const uploadsFetchRequest = z.object({
  dir: z.string().regex(patterns.uploadDir).refine((d) => !d.startsWith('/')),
  mode: z.enum(['merge', 'replace']).default('merge'),
  source: fetchSource,
});

export const forgetHostRequest = z.object({
  host: fetchSource.shape.host,
  port: fetchSource.shape.port,
});
