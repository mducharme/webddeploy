// Who did what from the web UI. Written before the action is attempted
// (outcome "requested") and updated once ddeploy answers, so an action
// that crashes the request still leaves a trace.
import type { AuditEntry } from '@webddeploy/shared';
import type { Db } from './db.ts';

export class AuditLog {
  private db: Db;
  private now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }

  begin(e: { email: string; serverId: string; action: string; target: string | null; detail?: unknown }): number {
    const r = this.db
      .prepare("INSERT INTO audit_log (at, email, server_id, action, target, detail, outcome) VALUES (?, ?, ?, ?, ?, ?, 'requested')")
      .run(this.now(), e.email, e.serverId, e.action, e.target, e.detail === undefined ? null : JSON.stringify(e.detail));
    return Number(r.lastInsertRowid);
  }

  /** The action went through; runId when it started a run. */
  succeeded(id: number, runId: string | null = null): void {
    this.db.prepare("UPDATE audit_log SET outcome = 'ok', run_id = ? WHERE id = ?").run(runId || null, id);
  }

  rejected(id: number, error: string): void {
    this.db.prepare("UPDATE audit_log SET outcome = 'rejected', error = ? WHERE id = ?").run(error.slice(0, 1000), id);
  }

  list(limit = 100): AuditEntry[] {
    const rows = this.db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(Math.min(Math.max(limit, 1), 1000)) as Array<{
      id: number; at: number; email: string; server_id: string; action: string; target: string | null;
      detail: string | null; run_id: string | null; outcome: AuditEntry['outcome']; error: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      at: new Date(r.at).toISOString(),
      email: r.email,
      server_id: r.server_id,
      action: r.action,
      target: r.target,
      detail: r.detail ? (JSON.parse(r.detail) as unknown) : null,
      run_id: r.run_id,
      outcome: r.outcome,
      error: r.error,
    }));
  }
}
