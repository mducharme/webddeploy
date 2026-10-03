// Runtime configuration, from the environment (/etc/webddeploy/env in
// production — see deploy/). Fails fast, with every problem listed, on a
// misconfiguration rather than at the first request that needs a value.
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  );

const serverEntry = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
  name: z.string().min(1),
  command: z.array(z.string().min(1)).min(1),
});
export type ServerEntry = z.infer<typeof serverEntry>;

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8790),
  PUBLIC_URL: z.url().default('http://localhost:5173'),
  DATABASE_PATH: z.string().default(fileURLToPath(new URL('../data/webddeploy.sqlite', import.meta.url))),
  STATIC_DIR: z.string().default(fileURLToPath(new URL('../../client/dist', import.meta.url))),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  /** Google Workspace domains (the ID token's `hd` claim) allowed to sign in. Empty: any, subject to ADMIN_EMAILS. */
  GOOGLE_ALLOWED_DOMAINS: csv,
  /**
   * Roles from configuration (can't be changed from the UI, so nobody can
   * lock everyone out). More users, of any role, are added by super-admins
   * in the UI. superadmin: also server settings, users, global options;
   * admin: every site action; viewer: read-only.
   */
  SUPERADMIN_EMAILS: csv,
  ADMIN_EMAILS: csv,
  VIEWER_EMAILS: csv,
  /** Development only: /auth/dev-login signs in as this email, no Google round trip. */
  DEV_LOGIN_EMAIL: z.string().default(''),

  /**
   * How to reach ddeploy's `api` on this server, as a command prefix
   * ("api <verb> ..." is appended). Whitespace-separated, or a JSON array.
   * Production: sudo -n /opt/ddeploy/provision.sh (the one sudoers rule
   * `ddeploy init-web` installs). Development against ddeploy's docker
   * harness: docker exec -i ddeploytest-web-1 /opt/ddeploy/provision.sh
   */
  DDEPLOY_COMMAND: z.string().default('sudo -n /opt/ddeploy/provision.sh'),
  SERVER_ID: z.string().default('local'),
  SERVER_NAME: z.string().default(hostname()),
  /** Several servers: a JSON array of {id, name, command[]}; overrides the three above. */
  SERVERS: z.string().default(''),

  SESSION_IDLE_HOURS: z.coerce.number().positive().default(12),
  SESSION_MAX_DAYS: z.coerce.number().positive().default(7),
  SITES_CACHE_SECONDS: z.coerce.number().min(0).default(20),
  DOCTOR_CACHE_SECONDS: z.coerce.number().min(0).default(60),
  LOG_POLL_MS: z.coerce.number().int().min(200).default(1500),
});

export interface Config {
  production: boolean;
  host: string;
  port: number;
  publicUrl: URL;
  databasePath: string;
  staticDir: string;
  google: { clientId: string; clientSecret: string } | null;
  allowedDomains: string[];
  superadminEmails: string[];
  adminEmails: string[];
  viewerEmails: string[];
  devLoginEmail: string | null;
  servers: ServerEntry[];
  sessionIdleMs: number;
  sessionMaxMs: number;
  sitesCacheMs: number;
  doctorCacheMs: number;
  logPollMs: number;
}

export function parseCommand(raw: string): string[] {
  const s = raw.trim();
  if (s.startsWith('[')) return z.array(z.string().min(1)).min(1).parse(JSON.parse(s));
  return s.split(/\s+/).filter(Boolean);
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`invalid configuration:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';
  const problems: string[] = [];

  const google = e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET ? { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET } : null;
  const devLoginEmail = e.DEV_LOGIN_EMAIL.trim().toLowerCase() || null;
  if (production && devLoginEmail) problems.push('DEV_LOGIN_EMAIL must not be set in production');
  if (!google && !devLoginEmail) problems.push('set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (or DEV_LOGIN_EMAIL in development)');
  if (e.SUPERADMIN_EMAILS.length === 0 && e.ADMIN_EMAILS.length === 0 && !devLoginEmail) {
    problems.push('SUPERADMIN_EMAILS and ADMIN_EMAILS are both empty: nobody could sign in to manage anything');
  }
  const publicUrl = new URL(e.PUBLIC_URL);
  if (production && publicUrl.protocol !== 'https:') problems.push('PUBLIC_URL must be https:// in production');

  let servers: ServerEntry[];
  try {
    servers = e.SERVERS.trim()
      ? z.array(serverEntry).min(1).parse(JSON.parse(e.SERVERS))
      : [{ id: e.SERVER_ID, name: e.SERVER_NAME, command: parseCommand(e.DDEPLOY_COMMAND) }];
    const ids = new Set(servers.map((s) => s.id));
    if (ids.size !== servers.length) problems.push('SERVERS: duplicate id');
  } catch (err) {
    problems.push(`SERVERS / DDEPLOY_COMMAND: ${(err as Error).message}`);
    servers = [];
  }
  if (problems.length) throw new Error(`invalid configuration:\n${problems.map((p) => `  ${p}`).join('\n')}`);

  return {
    production,
    host: e.HOST,
    port: e.PORT,
    publicUrl,
    databasePath: e.DATABASE_PATH,
    staticDir: e.STATIC_DIR,
    google,
    allowedDomains: e.GOOGLE_ALLOWED_DOMAINS,
    // The development sign-in is a super-admin.
    superadminEmails: devLoginEmail && !e.SUPERADMIN_EMAILS.includes(devLoginEmail) ? [...e.SUPERADMIN_EMAILS, devLoginEmail] : e.SUPERADMIN_EMAILS,
    adminEmails: e.ADMIN_EMAILS,
    viewerEmails: e.VIEWER_EMAILS,
    devLoginEmail,
    servers,
    sessionIdleMs: e.SESSION_IDLE_HOURS * 3600_000,
    sessionMaxMs: e.SESSION_MAX_DAYS * 86400_000,
    sitesCacheMs: e.SITES_CACHE_SECONDS * 1000,
    doctorCacheMs: e.DOCTOR_CACHE_SECONDS * 1000,
    logPollMs: e.LOG_POLL_MS,
  };
}
