import { describe, expect, it } from 'vitest';
import { ADMIN, VIEWER, json, makeApp } from './helpers.ts';

const site = '/api/servers/local/sites/testsite';
const source = { user: 'deploy', host: 'old.example.com', path: '' };

describe('copy from another server', () => {
  it('shows the fetch key, to admins only', async () => {
    const { req } = makeApp({ as: ADMIN });
    const key = await json(await req('/api/servers/local/fetch-key'));
    expect(key.public_key).toMatch(/^ssh-ed25519 /);
    expect(key.authorized_keys).toContain('rrsync -ro');
    expect((await makeApp({ as: VIEWER }).req('/api/servers/local/fetch-key')).status).toBe(403);
  });

  it('tests a source: user@host:path and port go to ddeploy as argv', async () => {
    const { req, connector, audit } = makeApp();
    const res = await req(`${site}/uploads/fetch-test`, { method: 'POST', body: JSON.stringify({ source: { ...source, port: 2222 } }) });
    expect(res.status).toBe(200);
    expect((await json(res)).host_key.status).toBe('unknown');
    expect(connector.calls).toContainEqual(['fetch-test', 'testsite', '--source', 'deploy@old.example.com:', '--port', '2222', '--actor', ADMIN]);
    expect(audit.list()).toHaveLength(0);
  });

  it('confirming a host key is audited', async () => {
    const { req, connector, audit } = makeApp();
    const fp = 'SHA256:gnC9p+wt8OxQYBvT1Pe0+GsKV43d/73HqP3fZXeoQIo';
    const res = await req(`${site}/uploads/fetch-test`, { method: 'POST', body: JSON.stringify({ source, accept: fp }) });
    expect((await json(res)).files).toBe(3);
    expect(connector.calls.at(-1)).toContain('--accept');
    expect(audit.list()[0]).toMatchObject({ action: 'fetch.accept-host', detail: { host: 'old.example.com', fingerprint: fp } });
  });

  it('starts the copy as a run', async () => {
    const { req, connector, audit } = makeApp();
    const res = await req(`${site}/uploads/fetch`, {
      method: 'POST',
      body: JSON.stringify({ dir: 'web/uploads', mode: 'replace', source: { ...source, path: '/var/www/up' } }),
    });
    expect(res.status).toBe(202);
    expect(connector.calls).toContainEqual([
      'run', 'start', 'uploads-fetch', 'testsite', '--dir', 'web/uploads', '--mode', 'replace',
      '--source', 'deploy@old.example.com:/var/www/up', '--port', '22', '--actor', ADMIN,
    ]);
    expect(audit.list()[0]).toMatchObject({ action: 'uploads.fetch', detail: { source: 'deploy@old.example.com:/var/www/up' } });
  });

  it.each([
    ['an option as host', { ...source, host: '-oProxyCommand=id' }],
    ['a shell character in the path', { ...source, path: '/x;id' }],
    ['a space in the path', { ...source, path: '/x y' }],
    ['..', { ...source, path: 'up/../../etc' }],
    ['a path starting with -', { ...source, path: '-e' }],
    ['an uppercase login', { ...source, user: 'Root' }],
    ['port 0', { ...source, port: 0 }],
  ])('refuses %s without calling ddeploy', async (_, src) => {
    const { req, connector } = makeApp();
    const res = await req(`${site}/uploads/fetch-test`, { method: 'POST', body: JSON.stringify({ source: src }) });
    expect(res.status).toBe(400);
    expect(connector.calls.some((c) => c[0] === 'fetch-test')).toBe(false);
  });

  it('viewers can neither test nor copy', async () => {
    const { req } = makeApp({ as: VIEWER });
    expect((await req(`${site}/uploads/fetch-test`, { method: 'POST', body: JSON.stringify({ source }) })).status).toBe(403);
    expect((await req(`${site}/uploads/fetch`, { method: 'POST', body: JSON.stringify({ dir: 'web/uploads', source }) })).status).toBe(403);
  });

  it('forgetting a host key is audited', async () => {
    const { req, connector, audit } = makeApp();
    const res = await req('/api/servers/local/fetch-key/forget', { method: 'POST', body: JSON.stringify({ host: 'old.example.com', port: 22 }) });
    expect(res.status).toBe(200);
    expect(connector.calls).toContainEqual(['fetch-key', 'forget', '--host', 'old.example.com', '--port', '22', '--actor', ADMIN]);
    expect(audit.list()[0]).toMatchObject({ action: 'fetch.forget-host' });
  });
});

describe('log streams', () => {
  it('a log that can\'t be read says why, instead of closing silently', async () => {
    const { req, connector } = makeApp();
    connector.on('logs', () => {
      throw new Error("couldn't read /var/log/nginx/testsite.error.log");
    });
    const ctrl = new AbortController();
    const res = await req('/api/servers/local/logs/testsite.error/stream', { signal: ctrl.signal });
    const text = await res.text();
    expect(text).toContain('event: error');
    expect(text).toContain("couldn't read");
  });
});
