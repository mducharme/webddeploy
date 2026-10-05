import type { WorkersResponse } from '@webddeploy/shared';
import { describe, expect, it } from 'vitest';
import { lastRunText, workerStatus } from '../src/pages/WorkersTab.tsx';

type W = WorkersResponse['workers'][number];
type S = WorkersResponse['schedules'][number];
const w = (o: Partial<W>): W => ({ index: 0, command: 'php craft queue/listen', unit: 'ddeploy-worker-x-0', state: 'active', sub_state: 'running', restarts: 0, since: new Date().toISOString(), pid: 42, log: 'x.worker-0', ...o });
const s = (o: Partial<S>): S => ({ index: 0, cron: '*/5 * * * *', command: 'php craft queue/run', installed: 'current', running: false, last: null, log: null, ...o });

describe('worker status', () => {
  it.each([
    [{}, 'ok', 'running since'],
    [{ restarts: 9 }, 'warn', 'probably crashing'],
    [{ state: 'activating', sub_state: 'auto-restart' }, 'warn', 'restarting'],
    [{ state: 'failed' }, 'fail', 'gave up'],
    [{ state: 'inactive' }, 'off', 'stopped'],
    [{ state: 'missing' }, 'warn', 'deploy to start it'],
  ] as const)('%o → %s', (o, tone, text) => {
    const st = workerStatus(w(o));
    expect(st.tone).toBe(tone);
    expect(st.text).toContain(text);
  });
});

describe('schedule last run', () => {
  const t = new Date(Date.now() - 120_000).toISOString();
  it('ok, with how long it took', () => expect(lastRunText(s({ last: { started_at: t, finished_at: t, exit_code: 0, duration_s: 3 } }))).toMatchObject({ tone: 'ok', text: expect.stringContaining('took 3s') }));
  it('failed, with the exit code', () => expect(lastRunText(s({ last: { started_at: t, finished_at: t, exit_code: 2, duration_s: 1 } }))).toMatchObject({ tone: 'fail', text: expect.stringContaining('exit 2') }));
  it('running', () => expect(lastRunText(s({ running: true, last: { started_at: t, finished_at: null, exit_code: null, duration_s: null } })).tone).toBe('running'));
  it('installed by an older ddeploy: says when history starts', () => expect(lastRunText(s({ installed: 'legacy' })).text).toContain('next deploy'));
  it('never ran', () => expect(lastRunText(s({})).text).toBe('not run yet'));
});

import { cronLabel } from '../src/lib/format.ts';

describe('cronLabel', () => {
  it.each([
    ['* * * * *', 'every minute'],
    ['*/5 * * * *', 'every 5 minutes'],
    ['17 * * * *', 'hourly at :17'],
    ['0 3 * * *', 'daily at 03:00 (server time)'],
    ['0 3 * * 1', '0 3 * * 1'],
  ])('%s → %s', (expr, label) => expect(cronLabel(expr)).toBe(label));
});
