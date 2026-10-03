import { describe, expect, it } from 'vitest';
import { requiredRole } from '../src/access.ts';
import { ADMIN, SUPER, VIEWER, json, makeApp } from './helpers.ts';

const site = '/api/servers/local/sites/testsite';

describe('what each role may do', () => {
  // [method, path, minimum role]
  const matrix: Array<[string, string, 'viewer' | 'admin' | 'superadmin']> = [
    ['GET', '/api/me', 'viewer'],
    ['GET', '/api/servers/local/sites', 'viewer'],
    ['GET', `${site}`, 'viewer'],
    ['GET', `${site}/runs`, 'viewer'],
    ['GET', `${site}/previews`, 'viewer'],
    ['GET', `${site}/backups`, 'viewer'],
    ['GET', `${site}/uploads`, 'viewer'],
    ['GET', '/api/servers/local/doctor', 'viewer'],
    ['GET', '/api/servers/local/logs', 'viewer'],
    ['GET', `${site}/env`, 'admin'],
    ['GET', `${site}/db`, 'admin'],
    ['GET', `${site}/db/dump`, 'admin'],
    ['GET', `${site}/uploads/download`, 'admin'],
    ['GET', `${site}/backups/download`, 'admin'],
    ['GET', '/api/activity', 'admin'],
    ['POST', `${site}/deploy`, 'admin'],
    ['POST', '/api/servers/local/provision/inspect', 'admin'],
    ['PUT', `${site}/env`, 'admin'],
    ['POST', `${site}/db/credentials`, 'admin'],
    ['GET', '/api/servers/local/config', 'superadmin'],
    ['PUT', '/api/servers/local/config', 'superadmin'],
    ['GET', '/api/admin/users', 'superadmin'],
    ['PUT', '/api/admin/options', 'superadmin'],
  ];
  it.each(matrix)('%s %s needs %s', (method, path, role) => expect(requiredRole(method, path)).toBe(role));

  it('a viewer can look but not act', async () => {
    const { req, connector } = makeApp({ as: VIEWER });
    expect((await req('/api/servers/local/sites')).status).toBe(200);
    expect((await req(`${site}/runs`)).status).toBe(200);
    const deploy = await req(`${site}/deploy`, { method: 'POST' });
    expect(deploy.status).toBe(403);
    expect((await json(deploy)).error.message).toContain('admin');
    expect((await req(`${site}/env`)).status).toBe(403);
    expect((await req(`${site}/db/dump`)).status).toBe(403);
    expect(connector.calls.some((c) => c[0] === 'run')).toBe(false);
  });

  it('an admin acts on sites but not on the server', async () => {
    const { req } = makeApp({ as: ADMIN });
    expect((await req(`${site}/deploy`, { method: 'POST' })).status).toBe(202);
    expect((await req('/api/servers/local/config')).status).toBe(403);
    expect((await req('/api/admin/users')).status).toBe(403);
  });

  it('/me reports the role', async () => {
    expect((await json(await makeApp({ as: VIEWER }).req('/api/me'))).role).toBe('viewer');
    expect((await json(await makeApp({ as: SUPER }).req('/api/me'))).role).toBe('superadmin');
  });

  it('someone without a role is signed out', async () => {
    const { req } = makeApp({ as: 'stranger@example.com' });
    expect((await req('/api/me')).status).toBe(401);
  });
});

describe('users (super-admin)', () => {
  it('lists config users and adds, changes and removes UI users — taking effect at once', async () => {
    const { req, sessions, app, audit } = makeApp({ as: SUPER });
    const pmToken = sessions.create({ email: 'pm@example.com', name: null, picture: null });
    const asPm = (path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { cookie: `__Host-wdd_session=${pmToken}`, origin: 'https://ddeploy.example.test' } });
    expect((await asPm('/api/me')).status).toBe(401);

    let res = await req('/api/admin/users', { method: 'PUT', body: JSON.stringify({ email: 'PM@example.com', role: 'viewer' }) });
    expect(res.status).toBe(200);
    expect((await json(await asPm('/api/me'))).role).toBe('viewer');
    expect((await asPm(`${site}/deploy`, { method: 'POST' })).status).toBe(403);

    await req('/api/admin/users', { method: 'PUT', body: JSON.stringify({ email: 'pm@example.com', role: 'admin' }) });
    expect((await asPm(`${site}/deploy`, { method: 'POST' })).status).toBe(202);

    res = await req('/api/admin/users/pm%40example.com', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect((await asPm('/api/me')).status).toBe(401);

    const users = (await json(await req('/api/admin/users'))).users;
    expect(users.find((u: { email: string }) => u.email === ADMIN)).toMatchObject({ role: 'admin', source: 'config' });
    expect(audit.list().map((e) => e.action)).toEqual(['user.remove', 'deploy', 'user.set', 'user.set']);
  });

  it("can't change config-defined users, or themselves", async () => {
    const { req } = makeApp({ as: SUPER });
    expect((await req('/api/admin/users', { method: 'PUT', body: JSON.stringify({ email: ADMIN, role: 'viewer' }) })).status).toBe(409);
    expect((await req('/api/admin/users', { method: 'PUT', body: JSON.stringify({ email: SUPER, role: 'viewer' }) })).status).toBe(400);
    expect((await req(`/api/admin/users/${encodeURIComponent(ADMIN)}`, { method: 'DELETE' })).status).toBe(409);
    expect((await req('/api/admin/users', { method: 'PUT', body: JSON.stringify({ email: 'x@example.com', role: 'owner' }) })).status).toBe(400);
  });

  it('domain default: anyone from an allowed Workspace domain can view', async () => {
    const { req, sessions, app, config } = makeApp({ as: SUPER });
    config.allowedDomains.push('example.com');
    const token = sessions.create({ email: 'colleague@example.com', name: null, picture: null, hd: 'example.com' });
    const asColleague = () => app.request('/api/me', { headers: { cookie: `__Host-wdd_session=${token}` } });
    expect((await asColleague()).status).toBe(401);
    await req('/api/admin/options', { method: 'PUT', body: JSON.stringify({ domain_default_role: 'viewer' }) });
    expect((await json(await asColleague())).role).toBe('viewer');
  });
});

describe('server settings (super-admin)', () => {
  it('reads and writes through ddeploy, values on stdin, secrets not audited', async () => {
    const { req, connector, audit } = makeApp({ as: SUPER });
    expect((await json(await req('/api/servers/local/config'))).settings.length).toBeGreaterThan(10);
    const res = await req('/api/servers/local/config', {
      method: 'PUT',
      body: JSON.stringify({ set: { FPM_MAX_CHILDREN: '8', NOTIFY_WEBHOOK: 'https://hooks.slack.com/services/T/B/secret' } }),
    });
    expect(res.status).toBe(200);
    expect(connector.calls).toContainEqual(['config', 'set', '--actor', SUPER]);
    expect(connector.stdins[0]).toBe('FPM_MAX_CHILDREN=8\nNOTIFY_WEBHOOK=https://hooks.slack.com/services/T/B/secret\n');
    expect(JSON.stringify(audit.list()[0])).not.toContain('secret');
    expect(audit.list()[0]).toMatchObject({ action: 'config.set', detail: { FPM_MAX_CHILDREN: '8', NOTIFY_WEBHOOK: '(changed)' } });
  });

  it('refuses keys and characters ddeploy would refuse, without calling it', async () => {
    const { req, connector } = makeApp({ as: SUPER });
    expect((await req('/api/servers/local/config', { method: 'PUT', body: JSON.stringify({ set: { BASE_DOMAIN: 'evil.com' } }) })).status).toBe(400);
    expect((await req('/api/servers/local/config', { method: 'PUT', body: JSON.stringify({ set: { FPM_MAX_CHILDREN: '$(id)' } }) })).status).toBe(400);
    expect(connector.calls.some((c) => c[1] === 'set')).toBe(false);
  });
});
