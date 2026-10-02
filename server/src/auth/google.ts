// Google sign-in: OpenID Connect authorization code flow with PKCE, a
// state value and a nonce. The ID token is verified locally against
// Google's published keys (issuer, audience, expiry, nonce) — never just
// decoded.
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface Identity {
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  /** Google Workspace domain; absent for consumer accounts. */
  hd: string | null;
}

export interface OidcProvider {
  authorizationUrl(p: { state: string; nonce: string; codeVerifier: string; redirectUri: string }): string;
  /** Exchanges the code and returns the verified identity. */
  complete(p: { code: string; codeVerifier: string; nonce: string; redirectUri: string }): Promise<Identity>;
}

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const pkceChallenge = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url');

export interface GoogleOidcOptions {
  clientId: string;
  clientSecret: string;
  /** Overridable for tests. */
  fetch?: typeof fetch;
  keys?: JWTVerifyGetKey;
  /** Restricts Google's account chooser to one Workspace domain (a hint only — hd is still checked). */
  hostedDomain?: string;
}

export class GoogleOidc implements OidcProvider {
  private readonly opts: GoogleOidcOptions;
  private readonly keys: JWTVerifyGetKey;
  private readonly fetchFn: typeof fetch;

  constructor(opts: GoogleOidcOptions) {
    this.opts = opts;
    this.keys = opts.keys ?? createRemoteJWKSet(new URL(JWKS_URI));
    this.fetchFn = opts.fetch ?? fetch;
  }

  authorizationUrl(p: { state: string; nonce: string; codeVerifier: string; redirectUri: string }): string {
    const url = new URL(AUTH_ENDPOINT);
    url.search = new URLSearchParams({
      client_id: this.opts.clientId,
      redirect_uri: p.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: p.state,
      nonce: p.nonce,
      code_challenge: pkceChallenge(p.codeVerifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
      ...(this.opts.hostedDomain ? { hd: this.opts.hostedDomain } : {}),
    }).toString();
    return url.toString();
  }

  async complete(p: { code: string; codeVerifier: string; nonce: string; redirectUri: string }): Promise<Identity> {
    const res = await this.fetchFn(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: p.code,
        client_id: this.opts.clientId,
        client_secret: this.opts.clientSecret,
        redirect_uri: p.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: p.codeVerifier,
      }),
    });
    if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
    const body = (await res.json()) as { id_token?: string };
    if (!body.id_token) throw new Error('token response had no id_token');

    const { payload } = await jwtVerify(body.id_token, this.keys, { issuer: ISSUERS, audience: this.opts.clientId });
    if (payload.nonce !== p.nonce) throw new Error('nonce mismatch');
    if (typeof payload.email !== 'string') throw new Error('ID token has no email');
    return {
      email: payload.email.toLowerCase(),
      emailVerified: payload.email_verified === true,
      name: typeof payload.name === 'string' ? payload.name : null,
      picture: typeof payload.picture === 'string' ? payload.picture : null,
      hd: typeof payload.hd === 'string' ? payload.hd.toLowerCase() : null,
    };
  }
}

/** Why an identity may not sign in, or null if it may. */
export function rejectReason(id: Identity, adminEmails: readonly string[], allowedDomains: readonly string[]): string | null {
  if (!id.emailVerified) return 'email address not verified with Google';
  if (allowedDomains.length && (!id.hd || !allowedDomains.includes(id.hd))) return `${id.email} is not in an allowed Google Workspace domain`;
  if (!adminEmails.includes(id.email)) return `${id.email} is not on the admin list`;
  return null;
}
