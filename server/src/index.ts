import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { AuditLog } from './audit.ts';
import { GoogleOidc } from './auth/google.ts';
import { SessionStore } from './auth/sessions.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { ServerRegistry } from './servers.ts';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const db = openDb(config.databasePath);
const sessions = new SessionStore(db, { idleMs: config.sessionIdleMs, maxMs: config.sessionMaxMs });
const oidc = config.google
  ? new GoogleOidc({ ...config.google, hostedDomain: config.allowedDomains.length === 1 ? config.allowedDomains[0] : undefined })
  : null;

const app = createApp({
  config,
  db,
  servers: ServerRegistry.fromConfig(config.servers),
  oidc,
  sessions,
  audit: new AuditLog(db),
});

sessions.sweep();
setInterval(() => sessions.sweep(), 3600_000).unref();

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`webddeploy listening on http://${info.address}:${info.port} (public URL ${config.publicUrl.origin})`);
  for (const s of config.servers) console.log(`  server '${s.id}': ${s.command.join(' ')} api ...`);
  if (config.google) console.log(`  Google sign-in: the OAuth client's authorized redirect URI must be exactly ${new URL('/auth/callback', config.publicUrl).toString()}`);
  if (config.devLoginEmail) console.warn(`  DEV LOGIN enabled as ${config.devLoginEmail} — development only`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
