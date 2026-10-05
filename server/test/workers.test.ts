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
