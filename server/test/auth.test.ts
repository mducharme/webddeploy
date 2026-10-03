import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWTPayload } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { GoogleOidc, rejectReason, type Identity } from '../src/auth/google.ts';
import { safeReturnTo } from '../src/routes/auth.ts';
import { ADMIN, makeApp } from './helpers.ts';

let privateKey: CryptoKey;
let keys: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }] });
});

const sign = (claims: JWTPayload) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer('https://accounts.google.com')
    .setAudience('client-id')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);

/** A GoogleOidc whose token endpoint returns an ID token with these claims (nonce filled in from the sign-in). */
function googleReturning(claims: (nonce: string) => Promise<string>) {
  let lastNonce = '';
  const oidc = new GoogleOidc({
    clientId: 'client-id',
    clientSecret: 'secret',
    keys,
    fetch: async (_url, init) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('code_verifier')).toBeTruthy();
      expect(body.get('code')).toBe('the-code');
      return new Response(JSON.stringify({ id_token: await claims(lastNonce) }), { status: 200 });
    },
  });
  const authorizationUrl = oidc.authorizationUrl.bind(oidc);
  oidc.authorizationUrl = (p) => {
    lastNonce = p.nonce;
    return authorizationUrl(p);
  };
  return oidc;
}

async function signIn(app: ReturnType<typeof makeApp>['app'], returnTo = '/sites/testsite') {
  const login = await app.request(`/auth/login?return_to=${encodeURIComponent(returnTo)}`);
  expect(login.status).toBe(302);
  const location = new URL(login.headers.get('location')!);
  expect(location.origin).toBe('https://accounts.google.com');
  expect(location.searchParams.get('code_challenge_method')).toBe('S256');
  const state = location.searchParams.get('state')!;
  return app.request(`/auth/callback?state=${state}&code=the-code`);
}

describe('Google sign-in', () => {
  it('signs in an admin and returns to where they were', async () => {
    const oidc = googleReturning((nonce) => sign({ email: ADMIN, email_verified: true, nonce, name: 'Admin' }));
    const { app } = makeApp({ oidc });
    const res = await signIn(app);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/sites/testsite');
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^__Host-wdd_session=/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    const me = await app.request('/api/me', { headers: { cookie: cookie.split(';')[0]! } });
    expect(me.status).toBe(200);
  });

  it('refuses someone not on the admin list', async () => {
    const oidc = googleReturning((nonce) => sign({ email: 'intruder@example.com', email_verified: true, nonce }));
    const { app } = makeApp({ oidc });
    const res = await signIn(app);
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await res.text()).toContain('been given access');
  });

  it('refuses a token with the wrong nonce', async () => {
    const oidc = googleReturning(() => sign({ email: ADMIN, email_verified: true, nonce: 'replayed' }));
    const { app } = makeApp({ oidc });
    expect((await signIn(app)).status).toBe(400);
  });

  it('refuses a token for another client (audience)', async () => {
    const oidc = googleReturning((nonce) =>
      new SignJWT({ email: ADMIN, email_verified: true, nonce })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer('https://accounts.google.com')
        .setAudience('someone-else')
        .setExpirationTime('5m')
        .sign(privateKey),
    );
    const { app } = makeApp({ oidc });
    expect((await signIn(app)).status).toBe(400);
  });

  it('refuses a replayed state', async () => {
    const oidc = googleReturning((nonce) => sign({ email: ADMIN, email_verified: true, nonce }));
    const { app } = makeApp({ oidc });
    const login = await app.request('/auth/login');
    const state = new URL(login.headers.get('location')!).searchParams.get('state')!;
    expect((await app.request(`/auth/callback?state=${state}&code=the-code`)).status).toBe(302);
    expect((await app.request(`/auth/callback?state=${state}&code=the-code`)).status).toBe(400);
  });

  it('never redirects off-site after sign-in', async () => {
    const oidc = googleReturning((nonce) => sign({ email: ADMIN, email_verified: true, nonce }));
    const { app } = makeApp({ oidc });
    const res = await signIn(app, '//evil.example/x');
    expect(res.headers.get('location')).toBe('/');
  });

  it('logs out', async () => {
    const { req } = makeApp();
    expect((await req('/auth/logout', { method: 'POST' })).status).toBe(200);
    expect((await req('/api/me')).status).toBe(401);
  });
});

describe('rejectReason', () => {
  const id = (o: Partial<Identity>): Identity => ({ email: ADMIN, emailVerified: true, name: null, picture: null, hd: 'example.com', ...o });
  it('someone with a role, in the allowed domain', () => expect(rejectReason(id({}), ['example.com'], true)).toBeNull());
  it('unverified email', () => expect(rejectReason(id({ emailVerified: false }), [], true)).toContain('not verified'));
  it('wrong Workspace domain', () => expect(rejectReason(id({ hd: 'other.com' }), ['example.com'], true)).toContain('domain'));
  it('consumer account when a domain is required', () => expect(rejectReason(id({ hd: null }), ['example.com'], true)).toContain('domain'));
  it('no role', () => expect(rejectReason(id({}), [], false)).toContain("hasn't been given access"));
});

describe('safeReturnTo', () => {
  it.each([
    ['/sites/x', '/sites/x'],
    [undefined, '/'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
  ])('%s -> %s', (input, expected) => expect(safeReturnTo(input)).toBe(expected));
});

describe('dev login', () => {
  it('works only when configured', async () => {
    const { app } = makeApp();
    expect((await app.request('/auth/dev-login')).status).toBe(404);
  });
});
