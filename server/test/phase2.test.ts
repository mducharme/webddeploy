import { describe, expect, it } from 'vitest';
import { DdeployError } from '../src/ddeploy/connector.ts';
import { ADMIN, FakeConnector, json, makeApp, readSse } from './helpers.ts';

const site = '/api/servers/local/sites/testsite';

describe('environment', () => {
  it('masks secret-looking values, shows the rest', async () => {
    const { req } = makeApp();
    const body = await json(await req(`${site}/env`));
    const byKey = Object.fromEntries(body.entries.map((e: { key: string }) => [e.key, e]));
    expect(byKey.DB_PASSWORD).toMatchObject({ value: '', masked: true, managed: true });
    expect(byKey.DB_PASSWORD.length).toBeGreaterThan(0);
    expect(byKey.MAIL_PASSWORD).toMatchObject({ value: '', masked: true });
    expect(byKey.APP_NAME).toMatchObject({ value: '"Test site"', masked: false });
  });

  it('reveals one value on request, and audits it', async () => {
    const { req, audit } = makeApp();
    const res = await req(`${site}/env/reveal`, { method: 'POST', body: JSON.stringify({ key: 'MAIL_PASSWORD' }) });
    expect(await json(res)).toEqual({ key: 'MAIL_PASSWORD', value: 'hunter2' });
    expect(audit.list()[0]).toMatchObject({ action: 'env.reveal', target: 'testsite', detail: { key: 'MAIL_PASSWORD' } });
  });

  it('sends values on stdin, never in argv, and audits key names only', async () => {
    const { req, connector, audit } = makeApp();
    const res = await req(`${site}/env`, { method: 'PUT', body: JSON.stringify({ set: { API_TOKEN: 's3cret value' }, unset: ['OLD'] }) });
    expect(res.status).toBe(200);
    const call = connector.calls.find((c) => c[0] === 'env')!;
    expect(call).toEqual(['env', 'testsite', '--apply', '--unset', 'OLD', '--actor', ADMIN]);
    expect(call.join(' ')).not.toContain('s3cret');
    expect(connector.stdins).toEqual(['API_TOKEN=s3cret value\n']);
    const entry = audit.list()[0]!;
    expect(entry).toMatchObject({ action: 'env.change', outcome: 'ok', detail: { set: ['API_TOKEN'], unset: ['OLD'] } });
    expect(JSON.stringify(entry)).not.toContain('s3cret');
  });

  it('rejects invalid keys and multi-line values', async () => {
    const { req, connector } = makeApp();
    expect((await req(`${site}/env`, { method: 'PUT', body: JSON.stringify({ set: { 'BAD-KEY': '1' } }) })).status).toBe(400);
    expect((await req(`${site}/env`, { method: 'PUT', body: JSON.stringify({ set: { A: 'x\ny' } }) })).status).toBe(400);
    expect(connector.calls).toEqual([]);
  });
});

describe('settings', () => {
  it('turns a request into ddeploy flags', async () => {
    const { req, connector, audit } = makeApp();
    const res = await req(`${site}/settings`, {
      method: 'PUT',
      body: JSON.stringify({ set: { client_max_body_size: '128m', additional_hostnames: ['alt', 'www2'] }, unset: ['static_cache'], branch: 'develop' }),
    });
    expect(res.status).toBe(200);
    expect(connector.calls).toContainEqual([
      'settings', 'testsite', '--set', 'client_max_body_size=128m', '--set', 'additional_hostnames=alt www2', '--unset', 'static_cache', '--branch', 'develop', '--actor', ADMIN,
    ]);
    expect(audit.list()[0]).toMatchObject({ action: 'settings.change', outcome: 'ok' });
  });

  it('branch: null clears the tracked branch', async () => {
    const { req, connector } = makeApp();
    await req(`${site}/settings`, { method: 'PUT', body: JSON.stringify({ branch: null }) });
    expect(connector.calls.find((c) => c[0] === 'settings')).toContain('--clear-branch');
  });

  it('refuses keys outside the allowlist without calling ddeploy', async () => {
    const { req, connector } = makeApp();
    const res = await req(`${site}/settings`, { method: 'PUT', body: JSON.stringify({ set: { db_env_scheme: 'none' } }) });
    expect(res.status).toBe(400);
    expect(connector.calls).toEqual([]);
  });

  it('refuses an empty change', async () => {
    const { req } = makeApp();
    expect((await req(`${site}/settings`, { method: 'PUT', body: JSON.stringify({}) })).status).toBe(400);
  });
});

describe('database', () => {
  it('reports info', async () => {
    const { req } = makeApp();
    const body = await json(await req(`${site}/db`));
    expect(body.tables[0].name).toBe('posts');
  });

  it('hands out credentials only on an audited POST', async () => {
    const { req, audit } = makeApp();
    expect((await req(`${site}/db/credentials`)).status).toBe(404);
    const body = await json(await req(`${site}/db/credentials`, { method: 'POST' }));
    expect(body.user).toBe('testsite');
    expect(audit.list()[0]).toMatchObject({ action: 'db.credentials', outcome: 'ok' });
  });

  it('streams a dump as a download', async () => {
    const { req, audit } = makeApp();
    const res = await req(`${site}/db/dump`);
    expect(res.headers.get('content-type')).toBe('application/gzip');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="testsite-\d{8}T\d{6}Z\.sql\.gz"$/);
    expect(new Uint8Array(await res.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([0x1f, 0x8b]));
    expect(audit.list()[0]).toMatchObject({ action: 'db.download', outcome: 'ok' });
  });

  it('a dump that fails before any output is a normal error', async () => {
    const connector = new FakeConnector();
    connector.dump = new DdeployError('not_found', "no snapshot '20261002T000000Z-manual'");
    const { req, audit } = makeApp({ connector });
    const res = await req(`${site}/db/dump?snapshot=20261002T000000Z-manual`);
    expect(res.status).toBe(404);
    expect(audit.list()[0]).toMatchObject({ outcome: 'rejected' });
  });

  it('pipes an uploaded dump to ddeploy over stdin', async () => {
    const { req, connector, audit } = makeApp();
    const res = await req(`${site}/db/import`, { method: 'POST', body: 'CREATE TABLE t (id int);\n', headers: { 'content-type': 'application/octet-stream', 'x-filename': 'export.sql' } });
    expect(res.status).toBe(202);
    expect(connector.calls).toContainEqual(['run', 'start', 'db-import', 'testsite', '--actor', ADMIN]);
    expect(connector.stdins).toEqual(['CREATE TABLE t (id int);\n']);
    expect(audit.list()[0]).toMatchObject({ action: 'db.import', detail: { filename: 'export.sql' }, run_id: '20261002T130000Z-aaaaaa' });
  });

  it('refuses an upload over the limit before reading it', async () => {
    const connector = new FakeConnector().on('info', () => ({ ...(JSON.parse(JSON.stringify(require_info()))), limits: { db_import_max_bytes: 10 } }));
    const { req } = makeApp({ connector });
    const res = await req(`${site}/db/import`, { method: 'POST', body: 'x'.repeat(100), headers: { 'content-type': 'application/octet-stream', 'content-length': '100' } });
    expect(res.status).toBe(400);
    expect(connector.calls.some((c) => c[1] === 'start')).toBe(false);
  });

  it('restores a snapshot', async () => {
    const { req, connector } = makeApp();
    expect((await req(`${site}/db/restore`, { method: 'POST', body: JSON.stringify({ snapshot: '../etc' }) })).status).toBe(400);
    const res = await req(`${site}/db/restore`, { method: 'POST', body: JSON.stringify({ snapshot: '20261002T145413Z-pre-import' }) });
    expect(res.status).toBe(202);
    expect(connector.calls).toContainEqual(['run', 'start', 'db-restore', 'testsite', '--snapshot', '20261002T145413Z-pre-import', '--actor', ADMIN]);
  });
});

describe('recovery', () => {
  it('rolls back to a given commit', async () => {
    const { req, connector } = makeApp();
    const sha = 'a'.repeat(40);
    expect((await req(`${site}/rollback`, { method: 'POST', body: JSON.stringify({ sha }) })).status).toBe(202);
    expect(connector.calls).toContainEqual(['run', 'start', 'rollback', 'testsite', '--sha', sha, '--actor', ADMIN]);
    expect((await req(`${site}/rollback`, { method: 'POST', body: JSON.stringify({ sha: 'nope; id' }) })).status).toBe(400);
  });

  it('cancels a run', async () => {
    const { req, connector, audit } = makeApp();
    const res = await req('/api/servers/local/runs/20261002T130000Z-aaaaaa/cancel', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(connector.calls).toContainEqual(['run', 'cancel', '20261002T130000Z-aaaaaa', '--actor', ADMIN]);
    expect(audit.list()[0]).toMatchObject({ action: 'run.cancel' });
  });

  it('lists commits between two SHAs, cached', async () => {
    const { req, connector } = makeApp();
    const q = `?from=${'a'.repeat(40)}&to=${'b'.repeat(40)}`;
    await req(`${site}/commits${q}`);
    const body = await json(await req(`${site}/commits${q}`));
    expect(body.ahead.length).toBeGreaterThan(0);
    expect(connector.calls.filter((c) => c[0] === 'commits')).toHaveLength(1);
  });
});

describe('streams', () => {
  it('several followers of one log share ddeploy calls', async () => {
    const connector = new FakeConnector().on('logs', (args) => {
      if (args.includes('--lines')) return { api_version: 1, name: 'testsite', size: 10, offset: 0, next_offset: 10, rotated: false, text: 'x'.repeat(10) };
      return { api_version: 1, name: 'testsite', size: 10, offset: 10, next_offset: 10, rotated: false, text: '' };
    });
    const { req } = makeApp({ connector });
    const ctrl = [new AbortController(), new AbortController(), new AbortController()];
    const responses = await Promise.all(ctrl.map((a) => req(`${site.replace('/sites/testsite', '')}/logs/testsite/stream`, { signal: a.signal })));
    await new Promise((r) => setTimeout(r, 700));
    ctrl.forEach((a) => a.abort());
    await Promise.all(responses.map((r) => r.body?.cancel().catch(() => {})));
    const polls = connector.calls.filter((c) => c[0] === 'logs' && c.includes('--offset'));
    // 3 followers, ~3 poll ticks at 200ms: coalesced to about one call per tick.
    expect(polls.length).toBeLessThanOrEqual(4);
  });

  it('run streams end with a ping-free sequence for short runs', async () => {
    const { req } = makeApp();
    const events = await readSse(await req('/api/servers/local/runs/20261002T122933Z-195ba4/stream'));
    expect(events.map((e) => e.event)).not.toContain('ping');
  });
});

function require_info() {
  return { api_version: 1, hostname: 'h', ddeploy: { sha: null, branch: null }, base_domain: 'x', php: { default: '8.3', baseline: [], installed: [] }, node: { enabled: true, default: '22' }, features: { webhook: false, backups: false, db_backups: false, preview_prune: false, web: true }, preview_db_mode: 'shared', basic_auth_default: false };
}
