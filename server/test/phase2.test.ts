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
    expect(await json(res)).toEqual({ key: 'MAIL_PASSWORD', value: 'fixture-mail-password' });
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

describe('previews', () => {
  it('creates a preview with exactly the chosen options', async () => {
    const { req, connector, audit } = makeApp();
    const res = await req(`${site}/previews`, { method: 'POST', body: JSON.stringify({ branch: 'feature/header', mode: 'isolated', seed: false, auth: false }) });
    expect(res.status).toBe(202);
    expect(connector.calls).toContainEqual([
      'run', 'start', 'preview-create', 'testsite', '--branch', 'feature/header', '--isolated', '--no-seed', '--no-auth', '--actor', ADMIN,
    ]);
    expect(audit.list()[0]).toMatchObject({ action: 'preview.create', target: 'testsite', outcome: 'ok' });
  });

  it('defaults to the server mode and basic auth on (no flags)', async () => {
    const { req, connector } = makeApp();
    await req(`${site}/previews`, { method: 'POST', body: JSON.stringify({ branch: 'develop' }) });
    expect(connector.calls).toContainEqual(['run', 'start', 'preview-create', 'testsite', '--branch', 'develop', '--actor', ADMIN]);
  });

  it('seed is irrelevant to a shared preview', async () => {
    const { req, connector } = makeApp();
    await req(`${site}/previews`, { method: 'POST', body: JSON.stringify({ branch: 'develop', mode: 'shared', seed: false }) });
    expect(connector.calls.find((c) => c[2] === 'preview-create')).not.toContain('--no-seed');
  });

  it('redeploys and removes by branch', async () => {
    const { req, connector, audit } = makeApp();
    expect((await req(`${site}/previews/deploy`, { method: 'POST', body: JSON.stringify({ branch: 'develop' }) })).status).toBe(202);
    expect((await req(`${site}/previews/remove`, { method: 'POST', body: JSON.stringify({ branch: 'develop' }) })).status).toBe(202);
    expect(connector.calls).toContainEqual(['run', 'start', 'preview-deploy', 'testsite', '--branch', 'develop', '--actor', ADMIN]);
    expect(connector.calls).toContainEqual(['run', 'start', 'preview-remove', 'testsite', '--branch', 'develop', '--actor', ADMIN]);
    expect(audit.list().map((e) => e.action)).toEqual(['preview.remove', 'preview.deploy']);
  });

  it('refuses invalid branches without calling ddeploy', async () => {
    const { req, connector } = makeApp();
    for (const branch of ['-x', 'a/../b', 'with space', '']) {
      expect((await req(`${site}/previews`, { method: 'POST', body: JSON.stringify({ branch }) })).status).toBe(400);
    }
    expect((await req(`${site}/previews/remove`, { method: 'POST', body: JSON.stringify({}) })).status).toBe(400);
    expect(connector.calls).toEqual([]);
  });
});

describe('uploads', () => {
  it('lists upload dirs and snapshots', async () => {
    const { req } = makeApp();
    const body = await json(await req(`${site}/uploads`));
    expect(body.dirs.map((d: { dir: string }) => d.dir)).toContain('web/uploads');
  });

  it('streams an uploaded archive to ddeploy, with the dir and mode as validated flags', async () => {
    const { req, connector, audit } = makeApp();
    const res = await req(`${site}/uploads/import?dir=web/uploads&mode=replace`, {
      method: 'POST',
      body: 'TARDATA',
      headers: { 'content-type': 'application/octet-stream', 'x-filename': 'media (folder)', 'x-file-count': '42' },
    });
    expect(res.status).toBe(202);
    expect(connector.calls).toContainEqual(['run', 'start', 'uploads-import', 'testsite', '--dir', 'web/uploads', '--mode', 'replace', '--actor', ADMIN]);
    expect(connector.stdins).toEqual(['TARDATA']);
    expect(audit.list()[0]).toMatchObject({ action: 'uploads.import', detail: { dir: 'web/uploads', mode: 'replace', source: 'media (folder)', files: 42 } });
  });

  it.each([
    ['an absolute dir', '?dir=/etc&mode=merge'],
    ['a dir with shell characters', '?dir=web;id&mode=merge'],
    ['a bad mode', '?dir=web/uploads&mode=nuke'],
    ['no dir', '?mode=merge'],
  ])('refuses %s without calling ddeploy', async (_, q) => {
    const { req, connector } = makeApp();
    const res = await req(`${site}/uploads/import${q}`, { method: 'POST', body: 'x', headers: { 'content-type': 'application/octet-stream' } });
    expect(res.status).toBe(400);
    expect(connector.calls.some((c) => c[0] === 'run')).toBe(false);
  });

  it('restores and snapshots', async () => {
    const { req, connector } = makeApp();
    expect((await req(`${site}/uploads/restore`, { method: 'POST', body: JSON.stringify({ snapshot: '../../x' }) })).status).toBe(400);
    expect((await req(`${site}/uploads/restore`, { method: 'POST', body: JSON.stringify({ snapshot: '20261003T023535Z-pre-import-web-uploads' }) })).status).toBe(202);
    expect((await req(`${site}/uploads/snapshot`, { method: 'POST' })).status).toBe(202);
    expect(connector.calls).toContainEqual(['run', 'start', 'uploads-restore', 'testsite', '--snapshot', '20261003T023535Z-pre-import-web-uploads', '--actor', ADMIN]);
    expect(connector.calls).toContainEqual(['run', 'start', 'uploads-snapshot', 'testsite', '--actor', ADMIN]);
  });

  it('downloads a folder as a .tar.gz', async () => {
    const { req, connector } = makeApp();
    const res = await req(`${site}/uploads/download?dir=web/uploads`);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="testsite-web-uploads-\d{8}T\d{6}Z\.tar\.gz"$/);
    expect(connector.calls).toContainEqual(['uploads', 'download', 'testsite', '--dir', 'web/uploads']);
  });
});

describe('backups', () => {
  it('reports dumps, the file mirror and versions', async () => {
    const { req } = makeApp();
    const body = await json(await req(`${site}/backups`));
    expect(body.database.dumps.length).toBeGreaterThan(0);
    expect(body.uploads.mirror.map((m: { dir: string }) => m.dir)).toContain('web/uploads');
  });

  it('backs up now, database or files', async () => {
    const { req, connector, audit } = makeApp();
    expect((await req(`${site}/backups/run`, { method: 'POST', body: JSON.stringify({ what: 'database' }) })).status).toBe(202);
    expect((await req(`${site}/backups/run`, { method: 'POST', body: JSON.stringify({ what: 'uploads' }) })).status).toBe(202);
    expect((await req(`${site}/backups/run`, { method: 'POST', body: JSON.stringify({ what: 'everything' }) })).status).toBe(400);
    expect(connector.calls).toContainEqual(['run', 'start', 'backup-database', 'testsite', '--actor', ADMIN]);
    expect(connector.calls).toContainEqual(['run', 'start', 'backup-uploads', 'testsite', '--actor', ADMIN]);
    expect(audit.list().map((e) => e.action)).toEqual(['backup.uploads', 'backup.database']);
  });

  it('restores the database from a dump, validating its name', async () => {
    const { req, connector } = makeApp();
    expect((await req(`${site}/backups/restore-db`, { method: 'POST', body: JSON.stringify({ file: '../../etc/passwd' }) })).status).toBe(400);
    expect((await req(`${site}/backups/restore-db`, { method: 'POST', body: JSON.stringify({ file: 'testsite-20261003-025058.sql.gz' }) })).status).toBe(202);
    expect(connector.calls).toContainEqual(['run', 'start', 'backup-restore-db', 'testsite', '--file', 'testsite-20261003-025058.sql.gz', '--actor', ADMIN]);
  });

  it('restores files from the mirror or one version', async () => {
    const { req, connector } = makeApp();
    await req(`${site}/backups/restore-uploads`, { method: 'POST', body: JSON.stringify({ dir: 'web/uploads' }) });
    await req(`${site}/backups/restore-uploads`, { method: 'POST', body: JSON.stringify({ dir: 'web/uploads', version: '20261003T025057Z' }) });
    expect(connector.calls).toContainEqual(['run', 'start', 'backup-restore-uploads', 'testsite', '--dir', 'web/uploads', '--actor', ADMIN]);
    expect(connector.calls).toContainEqual(['run', 'start', 'backup-restore-uploads', 'testsite', '--dir', 'web/uploads', '--version', '20261003T025057Z', '--actor', ADMIN]);
    expect((await req(`${site}/backups/restore-uploads`, { method: 'POST', body: JSON.stringify({ dir: '/etc' }) })).status).toBe(400);
    expect((await req(`${site}/backups/restore-uploads`, { method: 'POST', body: JSON.stringify({ dir: 'web/uploads', version: 'yesterday' }) })).status).toBe(400);
  });

  it('keeps, unkeeps and deletes dumps, audited', async () => {
    const { req, connector, audit } = makeApp();
    for (const action of ['keep', 'unkeep', 'delete']) {
      const res = await req(`${site}/backups/${action}`, { method: 'POST', body: JSON.stringify({ file: 'testsite-20261003-025058.sql.gz' }) });
      expect(res.status).toBe(200);
    }
    expect(connector.calls).toContainEqual(['backups', 'delete', 'testsite', '--file', 'testsite-20261003-025058.sql.gz', '--actor', ADMIN]);
    expect(audit.list().map((e) => e.action)).toEqual(['backup.delete', 'backup.unkeep', 'backup.keep']);
  });

  it('downloads a dump', async () => {
    const { req, connector } = makeApp();
    const res = await req(`${site}/backups/download?file=testsite-20261003-025058.sql.gz`);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="testsite-20261003-025058.sql.gz"');
    expect(connector.calls).toContainEqual(['backups', 'download', 'testsite', '--file', 'testsite-20261003-025058.sql.gz']);
  });
});
