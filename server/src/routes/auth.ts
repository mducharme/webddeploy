import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppDeps } from '../app.ts';
import { randomToken, rejectReason } from '../auth/google.ts';
import type { Config } from '../config.ts';

/** __Host- prefix (Secure, Path=/, no Domain) whenever we're on https. */
export function sessionCookieName(config: Config): string {
  return config.publicUrl.protocol === 'https:' ? '__Host-wdd_session' : 'wdd_session';
}

/** Only same-site relative paths: never an open redirect. */
export function safeReturnTo(raw: string | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/';
  return raw;
}

export function authRoutes(deps: AppDeps): Hono {
  const { config, db, sessions, oidc } = deps;
  const now = deps.now ?? Date.now;
  const app = new Hono();
  const redirectUri = new URL('/auth/callback', config.publicUrl).toString();

  const startSession = (c: Context, user: { email: string; name: string | null; picture: string | null; hd?: string | null }) => {
    const token = sessions.create(user);
    setCookie(c, sessionCookieName(config), token, {
      httpOnly: true,
      secure: config.publicUrl.protocol === 'https:',
      sameSite: 'Lax',
      path: '/',
      maxAge: Math.floor(config.sessionMaxMs / 1000),
    });
  };

  const fail = (c: Context, message: string, status: 400 | 403 = 403) =>
    c.html(
      `<!doctype html><meta charset="utf-8"><title>Sign-in refused</title>` +
        `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
        `<h1>Sign-in refused</h1><p>${escapeHtml(message)}</p><p><a href="/auth/login">Try another account</a></p>`,
      status,
    );

  app.get('/providers', (c) => c.json({ google: !!oidc, dev: !!config.devLoginEmail }));

  app.get('/login', (c) => {
    if (!oidc) return c.redirect(config.devLoginEmail ? `/auth/dev-login?return_to=${encodeURIComponent(safeReturnTo(c.req.query('return_to')))}` : '/');
    const state = randomToken();
    const nonce = randomToken();
    const codeVerifier = randomToken(48);
    db.prepare('INSERT INTO auth_requests (state, code_verifier, nonce, return_to, created_at) VALUES (?, ?, ?, ?, ?)').run(
      state,
      codeVerifier,
      nonce,
      safeReturnTo(c.req.query('return_to')),
      now(),
    );
    return c.redirect(oidc.authorizationUrl({ state, nonce, codeVerifier, redirectUri }));
  });

  app.get('/callback', async (c) => {
    if (!oidc) return c.notFound();
    const state = c.req.query('state');
    const code = c.req.query('code');
    if (c.req.query('error')) return fail(c, `Google returned: ${c.req.query('error')}`, 400);
    if (!state || !code) return fail(c, 'missing state or code', 400);
    const req = db.prepare('SELECT * FROM auth_requests WHERE state = ?').get(state) as
      | { code_verifier: string; nonce: string; return_to: string; created_at: number }
      | undefined;
    db.prepare('DELETE FROM auth_requests WHERE state = ?').run(state);
    if (!req || now() - req.created_at > 10 * 60_000) return fail(c, 'this sign-in link expired; start again', 400);

    let identity;
    try {
      identity = await oidc.complete({ code, codeVerifier: req.code_verifier, nonce: req.nonce, redirectUri });
    } catch (err) {
      console.warn('google sign-in failed:', (err as Error).message);
      return fail(c, 'Google sign-in could not be verified.', 400);
    }
    const reason = rejectReason(identity, config.allowedDomains, deps.access.roleFor(identity.email, identity.hd) !== null);
    if (reason) {
      console.warn(`sign-in refused: ${reason}`);
      return fail(c, reason);
    }
    startSession(c, identity);
    return c.redirect(req.return_to);
  });

  app.get('/dev-login', (c) => {
    if (config.production || !config.devLoginEmail) return c.notFound();
    // ?as=<email>: sign in as someone else, to try roles out (development
    // only, like the rest of this route; they still need a role).
    const as = (c.req.query('as') ?? '').trim().toLowerCase();
    const email = /^[^@\s]+@[^@\s]+$/.test(as) ? as : config.devLoginEmail;
    startSession(c, { email, name: email === config.devLoginEmail ? 'Development user' : email, picture: null });
    return c.redirect(safeReturnTo(c.req.query('return_to')));
  });

  app.post('/logout', (c) => {
    const name = sessionCookieName(config);
    sessions.destroy(getCookie(c, name));
    deleteCookie(c, name, { path: '/', secure: config.publicUrl.protocol === 'https:' });
    return c.json({ ok: true });
  });

  return app;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
