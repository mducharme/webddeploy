import { describe, expect, it } from 'vitest';
import { ADMIN, VIEWER, json, makeApp } from './helpers.ts';

const site = '/api/servers/local/sites/testsite';

describe('queue workers and scheduled tasks', () => {
  it('viewers can see them', async () => {
    const { req } = makeApp({ as: VIEWER });
    const r = await json(await req(`${site}/workers`));
    expect(r.workers[0].state).toBe('active');
  });

  it.each(['restart', 'stop', 'start'] as const)('%s a worker: argv to ddeploy, audited', async (action) => {
    const { req, connector, audit } = makeApp();
    const res = await req(`${site}/workers/0/${action}`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(connector.calls).toContainEqual(['workers', 'testsite', `--${action}`, '0', '--actor', ADMIN]);
    expect(audit.list()[0]).toMatchObject({ action: `worker.${action}`, detail: { index: 0 } });
  });

  it('set the lists: JSON on stdin (never argv), audited with counts only', async () => {
    const { req, connector, audit } = makeApp();
    const body = { queue_workers: ['php artisan queue:work --tries=3'], schedule: [{ cron: '* * * * *', cmd: 'php artisan schedule:run' }] };
    const res = await req(`${site}/workers`, { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(200);
    expect(connector.calls).toContainEqual(['workers', 'testsite', '--set', '--actor', ADMIN]);
    expect(JSON.parse(connector.stdins.at(-1)!)).toEqual(body);
    expect(audit.list()[0]).toMatchObject({ action: 'workers.config', detail: { workers: 1, schedules: 1 } });
  });

  it('refuses a bad cron before calling ddeploy; viewers cannot set', async () => {
    const { req, connector } = makeApp();
    const bad = await req(`${site}/workers`, { method: 'PUT', body: JSON.stringify({ queue_workers: [], schedule: [{ cron: 'daily', cmd: 'x' }] }), headers: { 'content-type': 'application/json' } });
    expect(bad.status).toBe(400);
    expect(connector.calls.some((c) => c.includes('--set'))).toBe(false);
    const viewer = makeApp({ as: VIEWER });
    expect((await viewer.req(`${site}/workers`, { method: 'PUT', body: '{"queue_workers":[],"schedule":[]}', headers: { 'content-type': 'application/json' } })).status).toBe(403);
  });

  it('pause and resume the schedules', async () => {
    const { req, connector } = makeApp();
    await req(`${site}/schedules/pause`, { method: 'POST' });
    await req(`${site}/schedules/resume`, { method: 'POST' });
    expect(connector.calls).toContainEqual(['schedules', 'testsite', '--pause', '--actor', ADMIN]);
    expect(connector.calls).toContainEqual(['schedules', 'testsite', '--resume', '--actor', ADMIN]);
  });

  it('run a scheduled task now: a run', async () => {
    const { req, connector } = makeApp();
    const res = await req(`${site}/schedules/0/run`, { method: 'POST' });
    expect(res.status).toBe(202);
    expect(connector.calls).toContainEqual(['run', 'start', 'schedule-run', 'testsite', '--index', '0', '--actor', ADMIN]);
  });

  it('refuses a bad action or index without calling ddeploy', async () => {
    const { req, connector } = makeApp();
    expect((await req(`${site}/workers/0/kill`, { method: 'POST' })).status).toBe(400);
    expect((await req(`${site}/workers/abc/restart`, { method: 'POST' })).status).toBe(400);
    expect((await req(`${site}/schedules/x/run`, { method: 'POST' })).status).toBe(400);
    expect(connector.calls.some((c) => c[0] === 'workers' && c.length > 2)).toBe(false);
  });

  it('viewers can’t act', async () => {
    const { req } = makeApp({ as: VIEWER });
    expect((await req(`${site}/workers/0/restart`, { method: 'POST' })).status).toBe(403);
    expect((await req(`${site}/schedules/pause`, { method: 'POST' })).status).toBe(403);
    expect((await req(`${site}/schedules/0/run`, { method: 'POST' })).status).toBe(403);
  });
});
