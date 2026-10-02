// SQLite via node:sqlite (no native module to build on the server).
// Holds only what's webddeploy's own: sessions, in-flight sign-ins and the
// audit log. Everything about sites lives in ddeploy and is read live.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const migrations: string[] = [
  `CREATE TABLE sessions (
     id_hash      TEXT PRIMARY KEY,
     email        TEXT NOT NULL,
     name         TEXT,
     picture      TEXT,
     created_at   INTEGER NOT NULL,
     last_seen_at INTEGER NOT NULL,
     expires_at   INTEGER NOT NULL
   );
   CREATE TABLE auth_requests (
     state         TEXT PRIMARY KEY,
     code_verifier TEXT NOT NULL,
     nonce         TEXT NOT NULL,
     return_to     TEXT NOT NULL,
     created_at    INTEGER NOT NULL
   );
   CREATE TABLE audit_log (
     id        INTEGER PRIMARY KEY AUTOINCREMENT,
     at        INTEGER NOT NULL,
     email     TEXT NOT NULL,
     server_id TEXT NOT NULL,
     action    TEXT NOT NULL,
     target    TEXT,
     detail    TEXT,
     run_id    TEXT,
     outcome   TEXT NOT NULL,
     error     TEXT
   );
   CREATE INDEX audit_log_at ON audit_log (at DESC);`,
  // Outcome 'started' became 'ok' (not every action starts a run).
  `UPDATE audit_log SET outcome = 'ok' WHERE outcome = 'started';`,
];

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = row.user_version; v < migrations.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}
