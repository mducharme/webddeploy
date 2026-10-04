import { describe, expect, it } from 'vitest';
import { ADMIN, VIEWER, json, makeApp } from './helpers.ts';

const site = '/api/servers/local/sites/testsite';

describe('config files', () => {
  it('lists, to admins only', async () => {
    const { req } = makeApp();
    expect((await json(await req(`${site}/files`))).files).toHaveLength(2);
    expect((await makeApp({ as: VIEWER }).req(`${site}/files`)).status).toBe(403);
  });

  it('opening a file is recorded (it may hold credentials)', async () => {
    const { req, audit, connector } = makeApp();
    const res = await req(`${site}/files/read`, { method: 'POST', body: JSON.stringify({ path: 'config/app.json' }) });
    expect((await json(res)).content).toContain('testsite');
    expect(connector.calls).toContainEqual(['files', 'testsite', '--read', 'config/app.json']);
    expect(audit.list()[0]).toMatchObject({ action: 'file.read', detail: { path: 'config/app.json' } });
  });

  it('saves through stdin, with the sha it was opened at; the audit log never sees the content', async () => {
    const { req, audit, connector } = makeApp();
    const content = '{"db": {"password": "hunter2"}}\n';
    const res = await req(`${site}/files`, { method: 'PUT', body: JSON.stringify({ path: 'config/app.json', content, expect_sha: 'a'.repeat(64) }) });
    expect(res.status).toBe(200);
    expect(connector.calls).toContainEqual(['files', 'testsite', '--write', 'config/app.json', '--expect-sha', 'a'.repeat(64), '--actor', ADMIN]);
    expect(connector.stdins[0]).toBe(content);
    expect(JSON.stringify(audit.list())).not.toContain('hunter2');
    expect(audit.list()[0]).toMatchObject({ action: 'file.edit', detail: { path: 'config/app.json' } });
  });

  it('restores a version', async () => {
    const { req, connector } = makeApp();
    await req(`${site}/files/restore`, { method: 'POST', body: JSON.stringify({ path: 'wp-config.php', version: '20261004T040106Z' }) });
    expect(connector.calls).toContainEqual(['files', 'testsite', '--restore', 'wp-config.php', '--version', '20261004T040106Z', '--actor', ADMIN]);
  });

  it.each(['../../etc/shadow', '/etc/passwd', 'a;b'])('refuses path %j without calling ddeploy', async (path) => {
    const { req, connector } = makeApp();
    expect((await req(`${site}/files/read`, { method: 'POST', body: JSON.stringify({ path }) })).status).toBe(400);
    expect(connector.calls.some((c) => c[0] === 'files')).toBe(false);
  });

  it('viewers can neither open nor save', async () => {
    const { req } = makeApp({ as: VIEWER });
    expect((await req(`${site}/files/read`, { method: 'POST', body: JSON.stringify({ path: 'config/app.json' }) })).status).toBe(403);
    expect((await req(`${site}/files`, { method: 'PUT', body: JSON.stringify({ path: 'config/app.json', content: '{}' }) })).status).toBe(403);
  });
});
