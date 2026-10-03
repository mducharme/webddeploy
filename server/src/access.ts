// Who may do what. Three roles, each including the one below:
//   viewer      read-only: sites, history, logs, health, previews, backups
//   admin       every site action, secrets, downloads (what v1 called admin)
//   superadmin  + server settings (provisioner.conf), users, global options
//
// A user's role comes from, in order: the config's SUPERADMIN_EMAILS,
// ADMIN_EMAILS (fixed: can't be changed from the UI), the users super-
// admins add in the UI, the config's VIEWER_EMAILS, and finally — if the
// global option says so — "anyone signed in from an allowed Workspace
// domain is a viewer". Resolved on every request, so a change takes
// effect immediately, sessions included.
import { ROLES, type GlobalOptions, type Role, type UserEntry } from '@webddeploy/shared';
import type { Config } from './config.ts';
import type { Db } from './db.ts';

export const ROLE_RANK: Record<Role, number> = { viewer: 1, admin: 2, superadmin: 3 };
export const atLeast = (role: Role, needed: Role) => ROLE_RANK[role] >= ROLE_RANK[needed];

const DEFAULT_OPTIONS: GlobalOptions = { domain_default_role: 'none' };

export class Access {
  private db: Db;
  private config: Config;
  private now: () => number;

  constructor(db: Db, config: Config, now: () => number = Date.now) {
    this.db = db;
    this.config = config;
    this.now = now;
  }

  private configRole(email: string): Role | null {
    if (this.config.superadminEmails.includes(email)) return 'superadmin';
    if (this.config.adminEmails.includes(email)) return 'admin';
    return null;
  }

  roleFor(email: string, hd: string | null): Role | null {
    const fixed = this.configRole(email);
    if (fixed) return fixed;
    const row = this.db.prepare('SELECT role FROM users WHERE email = ?').get(email) as { role: Role } | undefined;
    if (row) return row.role;
    if (this.config.viewerEmails.includes(email)) return 'viewer';
    const opts = this.options();
    if (opts.domain_default_role === 'viewer' && hd && this.config.allowedDomains.includes(hd)) return 'viewer';
    return null;
  }

  users(): UserEntry[] {
    const seen = new Map<string, number>();
    for (const r of this.db.prepare('SELECT email, MAX(last_seen_at) AS seen FROM sessions GROUP BY email').all() as Array<{ email: string; seen: number }>) {
      seen.set(r.email, r.seen);
    }
    const lastSeen = (email: string) => (seen.has(email) ? new Date(seen.get(email)!).toISOString() : null);
    const out: UserEntry[] = [];
    const add = (email: string, role: Role, source: UserEntry['source'], added_by: string | null = null, added_at: string | null = null) => {
      if (!out.some((u) => u.email === email)) out.push({ email, role, source, added_by, added_at, last_seen_at: lastSeen(email) });
    };
    for (const e of this.config.superadminEmails) add(e, 'superadmin', 'config');
    for (const e of this.config.adminEmails) add(e, 'admin', 'config');
    for (const r of this.db.prepare('SELECT * FROM users ORDER BY email').all() as Array<{ email: string; role: Role; added_by: string; added_at: number }>) {
      add(r.email, r.role, 'ui', r.added_by, new Date(r.added_at).toISOString());
    }
    for (const e of this.config.viewerEmails) add(e, 'viewer', 'config');
    return out;
  }

  /** Adds or changes a UI-managed user. Config-defined users can't be changed here. */
  setUser(email: string, role: Role, by: string): void {
    if (!ROLES.includes(role)) throw new Error(`unknown role '${role}'`);
    if (this.configRole(email) || this.config.viewerEmails.includes(email)) {
      throw new AccessError(`${email}'s role is set in the server's configuration (env file) and can't be changed here`);
    }
    this.db
      .prepare('INSERT INTO users (email, role, added_by, added_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET role = excluded.role')
      .run(email, role, by, this.now());
  }

  removeUser(email: string): boolean {
    if (this.configRole(email) || this.config.viewerEmails.includes(email)) {
      throw new AccessError(`${email} is set in the server's configuration (env file) and can't be removed here`);
    }
    const r = this.db.prepare('DELETE FROM users WHERE email = ?').run(email);
    this.db.prepare('DELETE FROM sessions WHERE email = ?').run(email);
    return Number(r.changes) > 0;
  }

  options(): GlobalOptions {
    const rows = this.db.prepare('SELECT key, value FROM options').all() as Array<{ key: string; value: string }>;
    const out = { ...DEFAULT_OPTIONS };
    for (const r of rows) if (r.key === 'domain_default_role' && (r.value === 'none' || r.value === 'viewer')) out.domain_default_role = r.value;
    return out;
  }

  setOptions(opts: Partial<GlobalOptions>): GlobalOptions {
    for (const [k, v] of Object.entries(opts)) {
      if (v === undefined) continue;
      this.db.prepare('INSERT INTO options (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
    }
    return this.options();
  }
}

export class AccessError extends Error {}

/** The role a request needs, from its method and path. Default: anything that changes something needs admin. */
const ADMIN_READS = [/\/env$/, /\/db$/, /\/db\/dump$/, /\/backups\/download$/, /\/uploads\/download$/, /^\/api\/activity$/, /\/provision\//, /\/fetch-key$/];
export function requiredRole(method: string, path: string): Role {
  if (path.startsWith('/api/admin/') || /^\/api\/servers\/[^/]+\/config$/.test(path)) return 'superadmin';
  if (method !== 'GET' && method !== 'HEAD') return 'admin';
  if (ADMIN_READS.some((re) => re.test(path))) return 'admin';
  return 'viewer';
}
