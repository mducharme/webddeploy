import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import type { AuditLog } from './audit.ts';
import type { OidcProvider } from './auth/google.ts';
import type { Session, SessionStore } from './auth/sessions.ts';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { DdeployError } from './ddeploy/connector.ts';
import { apiRoutes } from './routes/api.ts';
import { authRoutes, sessionCookieName } from './routes/auth.ts';
import type { ServerRegistry } from './servers.ts';
import { staticFiles } from './static.ts';

export interface AppDeps {
  config: Config;
  db: Db;
  servers: ServerRegistry;
  oidc: OidcProvider | null;
  sessions: SessionStore;
  audit: AuditLog;
  now?: () => number;
}

export type AppEnv = { Variables: { user: Session } };

const statusFor: Record<string, 400 | 404 | 409 | 501 | 502 | 503 | 504> = {
  bad_request: 400,
  not_found: 404,
  conflict: 409,
  unknown_verb: 501,
  incompatible: 502,
  error: 502,
  unavailable: 503,
  timeout: 504,
};

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const { config } = deps;
  const app = new Hono<AppEnv>();
  const origin = config.publicUrl.origin;

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https://*.googleusercontent.com'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'", 'https://accounts.google.com'],
        baseUri: ["'none'"],
      },
      referrerPolicy: 'same-origin',
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.get('/healthz', (c) => c.json({ ok: true }));

  // CSRF: the session cookie is SameSite=Lax, and every state-changing
  // request must also come from our own origin.
  app.use('*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.method !== 'OPTIONS') {
      const reqOrigin = c.req.header('origin');
      const site = c.req.header('sec-fetch-site');
      const sameOrigin = reqOrigin ? reqOrigin === origin : site === 'same-origin';
      if (!sameOrigin) return c.json({ error: { code: 'forbidden', message: 'cross-origin request refused' } }, 403);
    }
    await next();
  });

  app.route('/auth', authRoutes(deps));

  app.use('/api/*', async (c, next) => {
    const user = deps.sessions.get(getCookie(c, sessionCookieName(config)));
    if (!user || !config.adminEmails.includes(user.email)) {
      return c.json({ error: { code: 'unauthenticated', message: 'sign in required' } }, 401);
    }
    c.set('user', user);
    await next();
  });
  app.route('/api', apiRoutes(deps));
  app.all('/api/*', (c) => c.json({ error: { code: 'not_found', message: 'no such endpoint' } }, 404));

  app.route('/', staticFiles(config.staticDir));

  app.onError((err, c) => {
    if (err instanceof DdeployError) {
      return c.json({ error: { code: err.code, message: err.message } }, statusFor[err.code] ?? 502);
    }
    if (err instanceof HTTPException) {
      return c.json({ error: { code: 'http_error', message: err.message } }, err.status);
    }
    console.error(err);
    return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
  });

  return app;
}
