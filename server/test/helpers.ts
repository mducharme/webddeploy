import { readFileSync } from 'node:fs';
import { createApp } from '../src/app.ts';
import { Access } from '../src/access.ts';
import { AuditLog } from '../src/audit.ts';
import type { OidcProvider } from '../src/auth/google.ts';
import { SessionStore } from '../src/auth/sessions.ts';
import { loadConfig, type Config } from '../src/config.ts';
import { Readable } from 'node:stream';
import type { CallOptions, Connector, RawStream } from '../src/ddeploy/connector.ts';
import { DdeployError } from '../src/ddeploy/connector.ts';
import { openDb } from '../src/db.ts';
import { ServerRegistry } from '../src/servers.ts';

export const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../shared/test/fixtures/${name}.json`, import.meta.url), 'utf8'));

export const ORIGIN = 'https://ddeploy.example.test';
export const ADMIN = 'admin@example.com';
export const SUPER = 'super@example.com';
export const VIEWER = 'viewer@example.com';

/** A connector answering from the real fixtures, recording every call. */
export class FakeConnector implements Connector {
  calls: string[][] = [];
  stdins: string[] = [];
  handlers = new Map<string, (args: readonly string[]) => unknown>();
  dump: Buffer | DdeployError = Buffer.from([0x1f, 0x8b, 1, 2, 3]);

  on(verb: string, fn: (args: readonly string[]) => unknown): this {
    this.handlers.set(verb, fn);
    return this;
  }

  async stream(args: readonly string[]): Promise<RawStream> {
    this.calls.push([...args]);
    if (this.dump instanceof DdeployError) throw this.dump;
    return { stdout: Readable.from([this.dump]), done: Promise.resolve() };
  }

  async call(args: readonly string[], opts: CallOptions = {}): Promise<unknown> {
    this.calls.push([...args]);
    if (typeof opts.stdin === 'string') this.stdins.push(opts.stdin);
    else if (opts.stdin) {
      const chunks: Buffer[] = [];
      for await (const c of opts.stdin) chunks.push(Buffer.from(c as Buffer));
      this.stdins.push(Buffer.concat(chunks).toString('utf8'));
    }
    const key = args[0] === 'run' ? `run ${args[1]}` : args[0]!;
    const h = this.handlers.get(key);
    if (h) return h(args);
    switch (key) {
      case 'info': return fixture('info');
      case 'sites': return fixture('sites');
      case 'site-names': return fixture('site-names');
      case 'site':
        if (args[1] === 'nope') throw new DdeployError('not_found', "'nope' is not provisioned");
        return fixture('site');
      case 'events': return fixture('events');
      case 'previews': return fixture('previews');
      case 'doctor': return fixture('doctor');
      case 'logs': return args.length > 1 ? fixture('log-testsite') : fixture('logs');
      case 'inspect-repo': return fixture('inspect');
      case 'run start': return { api_version: 1, run_id: '20261002T130000Z-aaaaaa' };
      case 'run show': return fixture('run-show');
      case 'run log': return fixture('run-log');
      case 'run cancel': return { api_version: 1, run_id: args[2], cancelled: true };
      case 'env': return fixture('env');
      case 'settings': return fixture('site');
      case 'branches': return fixture('branches');
      case 'uploads': return fixture('uploads');
      case 'config': return fixture('config');
      case 'files':
        if (args.includes('--read')) return fixture('config-file');
        if (args.includes('--write') || args.includes('--restore')) return { api_version: 1, path: args[3], changed: true, sha256: 'b'.repeat(64) };
        return fixture('config-files');
      case 'fetch-key': return fixture('fetch-key');
      case 'fetch-test': return args.includes('--accept') ? fixture('fetch-test-known') : fixture('fetch-test-unknown');
      case 'backups':
        if (['keep', 'unkeep', 'delete'].includes(args[1]!)) return { api_version: 1, file: args[4], action: args[1] };
        return fixture('backups');
      case 'commits': return fixture('commits');
      case 'db':
        if (args[1] === 'info') return fixture('db-info');
        if (args[1] === 'credentials') return fixture('db-credentials');
        break;
    }
    throw new DdeployError('unknown_verb', `unknown api verb '${key}'`);
  }
}

export function testConfig(over: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: ORIGIN,
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    SUPERADMIN_EMAILS: SUPER,
    ADMIN_EMAILS: ADMIN,
    VIEWER_EMAILS: VIEWER,
    DATABASE_PATH: ':memory:',
    STATIC_DIR: '/nonexistent',
    LOG_POLL_MS: '200',
    ...over,
  });
}

export function makeApp(opts: { config?: Config; oidc?: OidcProvider | null; connector?: FakeConnector; now?: () => number; as?: string } = {}) {
  const config = opts.config ?? testConfig();
  const db = openDb(':memory:');
  const connector = opts.connector ?? new FakeConnector();
  const servers = new ServerRegistry();
  servers.add({ id: 'local', name: 'test server' }, connector);
  const sessions = new SessionStore(db, { idleMs: config.sessionIdleMs, maxMs: config.sessionMaxMs, now: opts.now });
  const audit = new AuditLog(db, opts.now);
  const access = new Access(db, config, opts.now);
  const app = createApp({ config, db, servers, oidc: opts.oidc ?? null, sessions, audit, access, now: opts.now });
  const token = sessions.create({ email: opts.as ?? ADMIN, name: 'User', picture: null });
  const cookie = `__Host-wdd_session=${token}`;
  const req = (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { cookie, origin: ORIGIN, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
    });
  return { app, db, config, connector, sessions, audit, access, req, cookie };
}

/** Reads a server-sent-events response into {event, data} pairs until it ends. */
export async function readSse(res: Response, max = 1000): Promise<Array<{ event: string; data: unknown }>> {
  const text = await res.text();
  const out: Array<{ event: string; data: unknown }> = [];
  for (const block of text.split('\n\n')) {
    const event = /^event: (.*)$/m.exec(block)?.[1];
    const data = /^data: (.*)$/m.exec(block)?.[1];
    if (event && data) out.push({ event, data: JSON.parse(data) });
    if (out.length >= max) break;
  }
  return out;
}

// Response bodies in tests are asserted on, not typed.
export const json = async (res: Response): Promise<any> => res.json();
