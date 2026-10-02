import { describe, expect, it } from 'vitest';
import { ADMIN, FakeConnector, ORIGIN, fixture, json, makeApp, readSse } from './helpers.ts';

describe('authentication and CSRF', () => {
  it('rejects API calls without a session', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/me');
    expect(res.status).toBe(401);
  });

  it('rejects a session for someone no longer on the admin list', async () => {
    const { app, sessions } = makeApp();
    const token = sessions.create({ email: 'former@example.com', name: null, picture: null });
    const res = await app.request('/api/me', { headers: { cookie: `__Host-wdd_session=${token}` } });
    expect(res.status).toBe(401);
  });

  it('returns the signed-in user and the servers', async () => {
    const { req } = makeApp();
    const me = await json(await req('/api/me'));
    expect(me).toMatchObject({ email: ADMIN, servers: [{ id: 'local', name: 'test server' }] });
  });

  it('refuses a cross-origin POST', async () => {
    const { req, connector } = makeApp();
    const res = await req('/api/servers/local/sites/testsite/deploy', { method: 'POST', headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    expect(connector.calls).toEqual([]);
  });

  it('refuses a POST with neither Origin nor Sec-Fetch-Site: same-origin', async () => {
    const { app, cookie } = makeApp();
    const res = await app.request('/api/servers/local/sites/testsite/deploy', { method: 'POST', headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it('sets security headers', async () => {
    const { app } = makeApp();
    const res = await app.request('/healthz');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('reads', () => {
  it('lists sites', async () => {
    const { req } = makeApp();
    const body = await json(await req('/api/servers/local/sites'));
    expect(body.sites.map((s: { name: string }) => s.name)).toEqual(['testsite', 'testsite-alt-main']);
  });

  it('404s an unknown server', async () => {
    const { req } = makeApp();
    expect((await req('/api/servers/other/sites')).status).toBe(404);
  });

  it('caches sites between calls, and ?fresh=1 bypasses the cache', async () => {
    const { req, connector } = makeApp();
    await req('/api/servers/local/sites');
    await req('/api/servers/local/sites');
    expect(connector.calls.filter((c) => c[0] === 'sites')).toHaveLength(1);
    await req('/api/servers/local/sites?fresh=1');
    expect(connector.calls.filter((c) => c[0] === 'sites')).toHaveLength(2);
  });

  it('validates site names before calling ddeploy', async () => {
    const { req, connector } = makeApp();
    const res = await req('/api/servers/local/sites/Bad..Name');
    expect(res.status).toBe(400);
    expect(connector.calls).toEqual([]);
  });

  it('maps ddeploy not_found to 404', async () => {
    const { req } = makeApp();
    const res = await req('/api/servers/local/sites/nope');
    expect(res.status).toBe(404);
    expect((await json(res)).error.code).toBe('not_found');
  });

  it('builds a site history from events', async () => {
    const { req, connector } = makeApp();
    const { runs } = await json(await req('/api/servers/local/sites/testsite/runs'));
    expect(connector.calls).toContainEqual(['events', '--site', 'testsite', '--limit', '2000']);
    expect(runs[0]).toMatchObject({ phase: 'succeeded' });
    expect(runs.every((r: { phase: string }) => r.phase !== 'started')).toBe(true);
  });

  it('returns active previews plus preview history only', async () => {
    const { req } = makeApp();
    const body = await json(await req('/api/servers/local/sites/testsite/previews'));
    expect(body.active[0].branch).toBe('alt-main');
    const kinds = new Set(body.history.map((r: { kind: string }) => r.kind));
    expect(kinds.size).toBeGreaterThan(0);
    for (const k of kinds) expect(['provision-preview', 'deploy-preview', 'remove-preview']).toContain(k);
  });

  it('passes doctor through, per site when asked', async () => {
    const { req, connector } = makeApp();
    const body = await json(await req('/api/servers/local/doctor?site=testsite'));
    expect(body.server.checks.length).toBeGreaterThan(0);
    expect(connector.calls).toContainEqual(['doctor', 'testsite']);
  });

  it('reads a log by lines or by offset', async () => {
    const { req, connector } = makeApp();
    await req('/api/servers/local/logs/testsite?lines=50');
    await req('/api/servers/local/logs/testsite?offset=1234');
    expect(connector.calls).toEqual([
      ['logs', 'testsite', '--lines', '50'],
      ['logs', 'testsite', '--offset', '1234'],
    ]);
  });

  it('rejects a negative offset', async () => {
    const { req } = makeApp();
    expect((await req('/api/servers/local/logs/testsite?offset=-1')).status).toBe(400);
  });
});

describe('deploy', () => {
  it('starts a run as the signed-in user and audits it', async () => {
    const { req, connector, audit } = makeApp();
    const res = await req('/api/servers/local/sites/testsite/deploy', { method: 'POST' });
    expect(res.status).toBe(202);
    expect(await json(res)).toEqual({ run_id: '20261002T130000Z-aaaaaa' });
    expect(connector.calls).toContainEqual(['run', 'start', 'deploy', 'testsite', '--actor', ADMIN]);
    expect(audit.list()[0]).toMatchObject({ action: 'deploy', target: 'testsite', outcome: 'ok', run_id: '20261002T130000Z-aaaaaa', email: ADMIN });
  });

  it('records a refused deploy in the audit log', async () => {
    const connector = new FakeConnector().on('run start', () => {
      throw Object.assign(new (class extends Error {})("'x' is a preview"), {});
    });
    const { req, audit } = makeApp({ connector });
    const res = await req('/api/servers/local/sites/testsite/deploy', { method: 'POST' });
    expect(res.status).toBe(500);
    expect(audit.list()[0]).toMatchObject({ outcome: 'rejected', error: "'x' is a preview" });
  });

  it('invalidates the sites cache', async () => {
    const { req, connector } = makeApp();
    await req('/api/servers/local/sites');
    await req('/api/servers/local/sites/testsite/deploy', { method: 'POST' });
    await req('/api/servers/local/sites');
    expect(connector.calls.filter((c) => c[0] === 'sites')).toHaveLength(2);
  });
});

describe('provision', () => {
  const body = { name: 'newsite', repo_url: 'git@github.com:org/newsite.git', hostnames: ['alt'], auth: true };

  it('inspects a repo', async () => {
    const { req, connector } = makeApp();
    const res = await req('/api/servers/local/provision/inspect', { method: 'POST', body: JSON.stringify({ repo_url: body.repo_url, branch: 'main' }) });
    expect(res.status).toBe(200);
    expect(connector.calls).toContainEqual(['inspect-repo', body.repo_url, '--branch', 'main']);
  });

  it('starts a provision run with exactly the validated flags', async () => {
    const { req, connector, audit } = makeApp();
    const res = await req('/api/servers/local/provision', { method: 'POST', body: JSON.stringify(body) });
    expect(res.status).toBe(202);
    expect(connector.calls).toContainEqual([
      'run', 'start', 'provision', 'newsite', body.repo_url, '--actor', ADMIN, '--hostnames', 'alt', '--auth',
    ]);
    expect(audit.list()[0]).toMatchObject({ action: 'provision', target: 'newsite', outcome: 'ok' });
  });

  it('rejects an invalid request with per-field issues, without calling ddeploy', async () => {
    const { req, connector } = makeApp();
    const res = await req('/api/servers/local/provision', {
      method: 'POST',
      body: JSON.stringify({ ...body, name: 'Bad Name', repo_url: 'git@github.com:x/y.git; id' }),
    });
    expect(res.status).toBe(400);
    const result = await json(res);
    expect(result.issues.map((i: { path: string }) => i.path).sort()).toEqual(['name', 'repo_url']);
    expect(connector.calls).toEqual([]);
  });

  it('ignores fields that are not provision flags (no --deploy-cmd through the web)', async () => {
    const { req, connector } = makeApp();
    await req('/api/servers/local/provision', { method: 'POST', body: JSON.stringify({ ...body, deploy_cmd: 'id' }) });
    expect(connector.calls.flat()).not.toContain('--deploy-cmd');
  });
});

describe('runs', () => {
  it('shows a run with its derived state', async () => {
    const { req } = makeApp();
    const body = await json(await req('/api/servers/local/runs/20261002T122933Z-195ba4'));
    expect(body.run).toMatchObject({ phase: 'succeeded', site: 'testsite', kind: 'provision' });
    expect(body.meta.actor).toBe('admin@example.com');
  });

  it('rejects malformed run ids', async () => {
    const { req } = makeApp();
    expect((await req('/api/servers/local/runs/..%2F..%2Fetc')).status).toBe(400);
  });

  it('streams a finished run: state, output, end', async () => {
    const { req } = makeApp();
    const res = await req('/api/servers/local/runs/20261002T122933Z-195ba4/stream');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = await readSse(res);
    expect(events.map((e) => e.event)).toEqual(['run', 'chunk', 'end']);
    expect((events[1]!.data as { text: string }).text).toContain('provisioned: https://testsite');
    expect(events[2]!.data).toEqual({ phase: 'succeeded' });
  });

  it('streams a live run until it finishes', async () => {
    let polls = 0;
    const base = fixture('run-show') as { events: unknown[]; log_size: number };
    const log = fixture('run-log') as { text: string; size: number };
    const connector = new FakeConnector()
      .on('run show', () => {
        polls++;
        const done = polls >= 3;
        return {
          ...base,
          events: done ? base.events : base.events.slice(0, 1),
          unit: { load_state: 'loaded', active_state: done ? 'inactive' : 'active', result: 'success' },
          log_size: done ? log.size : 10,
        };
      })
      .on('run log', (args) => {
        const offset = Number(args[args.indexOf('--offset') + 1]);
        const size = polls >= 3 ? log.size : 10;
        return { api_version: 1, run_id: args[2], size, offset, next_offset: size, rotated: false, text: log.text.slice(offset, size) };
      });
    const { req } = makeApp({ connector });
    const events = await readSse(await req('/api/servers/local/runs/20261002T122933Z-195ba4/stream'));
    const phases = events.filter((e) => e.event === 'run').map((e) => (e.data as { phase: string }).phase);
    expect(phases).toEqual(['running', 'succeeded']);
    const text = events.filter((e) => e.event === 'chunk').map((e) => (e.data as { text: string }).text).join('');
    expect(text).toBe(log.text);
    expect(events.at(-1)?.event).toBe('end');
  });

  it('lists recent runs across the server', async () => {
    const { req } = makeApp();
    const { runs } = await json(await req('/api/servers/local/runs?limit=2'));
    expect(runs).toHaveLength(2);
  });
});

describe('activity', () => {
  it('lists audit entries newest first', async () => {
    const { req } = makeApp();
    await req('/api/servers/local/sites/testsite/deploy', { method: 'POST' });
    await req('/api/servers/local/provision', { method: 'POST', body: JSON.stringify({ name: 'x', repo_url: 'git@h:o/x.git' }) });
    const { entries } = await json(await req('/api/activity'));
    expect(entries.map((e: { action: string }) => e.action)).toEqual(['provision', 'deploy']);
  });
});

describe('static client', () => {
  it('does not serve the SPA under /api', async () => {
    const { req } = makeApp();
    expect((await req('/api/nope')).status).toBe(404);
  });

  it('explains when the client is not built', async () => {
    const { app } = makeApp();
    const res = await app.request('/sites/foo', { headers: { origin: ORIGIN } });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('client not built');
  });
});
