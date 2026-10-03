// Server-side sessions: the browser holds a random token in an HttpOnly
// cookie, the database only its SHA-256. Idle and absolute expiry.
import { createHash } from 'node:crypto';
import type { Db } from '../db.ts';
import { randomToken } from './google.ts';

export interface Session {
  email: string;
  name: string | null;
  picture: string | null;
  /** Google Workspace domain the user signed in from, if any. */
  hd: string | null;
  createdAt: number;
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export class SessionStore {
  private db: Db;
  private idleMs: number;
  private maxMs: number;
  private now: () => number;

  constructor(db: Db, opts: { idleMs: number; maxMs: number; now?: () => number }) {
    this.db = db;
    this.idleMs = opts.idleMs;
    this.maxMs = opts.maxMs;
    this.now = opts.now ?? Date.now;
  }

  create(user: { email: string; name: string | null; picture: string | null; hd?: string | null }): string {
    const token = randomToken();
    const now = this.now();
    this.db
      .prepare('INSERT INTO sessions (id_hash, email, name, picture, hd, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(hash(token), user.email, user.name, user.picture, user.hd ?? null, now, now, now + this.maxMs);
    return token;
  }

  get(token: string | undefined): Session | null {
    if (!token) return null;
    const id = hash(token);
    const row = this.db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(id) as
      | { email: string; name: string | null; picture: string | null; hd: string | null; created_at: number; last_seen_at: number; expires_at: number }
      | undefined;
    if (!row) return null;
    const now = this.now();
    if (now > row.expires_at || now - row.last_seen_at > this.idleMs) {
      this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(id);
      return null;
    }
    // Touch at most once a minute: every API call reads the session.
    if (now - row.last_seen_at > 60_000) this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?').run(now, id);
    return { email: row.email, name: row.name, picture: row.picture, hd: row.hd, createdAt: row.created_at };
  }

  destroy(token: string | undefined): void {
    if (token) this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(hash(token));
  }

  /** Removes expired sessions and abandoned sign-ins. */
  sweep(): void {
    const now = this.now();
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ? OR last_seen_at < ?').run(now, now - this.idleMs);
    this.db.prepare('DELETE FROM auth_requests WHERE created_at < ?').run(now - 15 * 60_000);
  }
}
