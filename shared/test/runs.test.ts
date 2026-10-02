import { describe, expect, it } from 'vitest';
import type { DdeployEvent, RunShowResponse } from '../src/index.ts';
import { collapseRuns, parseTrigger, runFromShow, siteHistory } from '../src/index.ts';

const ev = (over: Partial<DdeployEvent>): DdeployEvent => ({
  ts: '2026-10-02T12:00:00Z',
  run_id: 'r1',
  site: 'site',
  kind: 'deploy',
  phase: 'started',
  trigger: 'web (a@b.c)',
  ...over,
});

describe('collapseRuns', () => {
  it('folds started + final into one run', () => {
    const [run, ...rest] = collapseRuns([
      ev({ from_sha: 'aaa' }),
      ev({ ts: '2026-10-02T12:00:09Z', phase: 'succeeded', to_sha: 'bbb', duration_s: 9 }),
    ]);
    expect(rest).toEqual([]);
    expect(run).toMatchObject({
      run_id: 'r1',
      phase: 'succeeded',
      started_at: '2026-10-02T12:00:00Z',
      finished_at: '2026-10-02T12:00:09Z',
      from_sha: 'aaa',
      to_sha: 'bbb',
      duration_s: 9,
    });
  });

  it("doesn't depend on event order", () => {
    const [run] = collapseRuns([ev({ phase: 'failed', error: 'boom' }), ev({})]);
    expect(run?.phase).toBe('failed');
    expect(run?.error).toBe('boom');
  });

  it('a run with only a started event is running', () => {
    expect(collapseRuns([ev({})], new Date('2026-10-02T12:05:00Z'))[0]?.phase).toBe('running');
  });

  it('a run that never finished, hours later, is presumed dead', () => {
    const [run] = collapseRuns([ev({})], new Date('2026-10-02T16:00:00Z'));
    expect(run?.phase).toBe('unknown');
    expect(run?.error).toContain('killed');
  });

  it('takes the kind from the final event (a deploy that turned out to be a rollback)', () => {
    expect(collapseRuns([ev({}), ev({ phase: 'succeeded', kind: 'rollback' })])[0]?.kind).toBe('rollback');
  });

  it('sorts newest first', () => {
    const runs = collapseRuns([
      ev({ run_id: 'old', ts: '2026-10-01T00:00:00Z' }),
      ev({ run_id: 'new', ts: '2026-10-03T00:00:00Z' }),
    ]);
    expect(runs.map((r) => r.run_id)).toEqual(['new', 'old']);
  });
});

describe('siteHistory', () => {
  it('appends legacy .deploys entries older than the event log', () => {
    const runs = siteHistory(
      [ev({ ts: '2026-10-02T00:00:00Z' }), ev({ ts: '2026-10-02T00:00:05Z', phase: 'succeeded' })],
      [
        { ts: '2026-09-01T00:00:00Z', sha: 'a'.repeat(40) },
        { ts: '2026-09-15T00:00:00Z', sha: 'b'.repeat(40) },
        { ts: '2026-10-02T00:00:05Z', sha: 'c'.repeat(40) },
      ],
      'site',
    );
    expect(runs.map((r) => r.to_sha?.[0] ?? null)).toEqual([null, 'b', 'a']);
    expect(runs[1]?.legacy).toBe(true);
  });
});

describe('runFromShow', () => {
  const show = (over: Partial<RunShowResponse>): RunShowResponse => ({
    api_version: 1,
    run_id: 'r1',
    meta: { run_id: 'r1', kind: 'deploy', site: 'site', argv: ['deploy', 'site'], actor: 'a@b.c', submitted_at: '2026-10-02T12:00:00Z' },
    events: [],
    unit: { load_state: 'loaded', active_state: 'active', result: 'success' },
    log_size: 0,
    ...over,
  });
  const at = (s: number) => new Date(Date.parse('2026-10-02T12:00:00Z') + s * 1000);

  it('queued while the unit runs but nothing has started (waiting on the lock)', () => {
    expect(runFromShow(show({}), at(120)).phase).toBe('queued');
  });

  it('failed when the unit is gone and nothing ever started', () => {
    const run = runFromShow(show({ unit: { load_state: 'not-found', active_state: 'inactive', result: 'success' } }), at(60));
    expect(run.phase).toBe('failed');
  });

  it('still queued within the grace period', () => {
    const run = runFromShow(show({ unit: { load_state: 'not-found', active_state: 'inactive', result: null } }), at(2));
    expect(run.phase).toBe('queued');
  });

  it('events win when present', () => {
    const run = runFromShow(show({ events: [ev({}), ev({ phase: 'succeeded' })], unit: { load_state: 'not-found', active_state: 'inactive', result: null } }), at(60));
    expect(run.phase).toBe('succeeded');
  });

  it('unknown when it started but the unit died without a final event', () => {
    const run = runFromShow(show({ events: [ev({})], unit: { load_state: 'not-found', active_state: 'inactive', result: null } }), at(60));
    expect(run.phase).toBe('unknown');
  });

  it('a run cancelled while queued says who cancelled it', () => {
    const run = runFromShow(show({ cancelled_by: 'boss@b.c', unit: { load_state: 'not-found', active_state: 'inactive', result: null } }), at(5));
    expect(run).toMatchObject({ phase: 'failed', error: 'cancelled by boss@b.c before it started' });
  });

  it('a run cancelled mid-way keeps its failed event, with who cancelled it', () => {
    const run = runFromShow(
      show({ cancelled_by: 'boss@b.c', events: [ev({}), ev({ phase: 'failed', error: 'interrupted' })], unit: { load_state: 'not-found', active_state: 'inactive', result: null } }),
      at(60),
    );
    expect(run).toMatchObject({ phase: 'failed', error: 'cancelled by boss@b.c' });
  });

  it('CLI runs (no meta) with only a started event stay running', () => {
    const run = runFromShow(show({ meta: null, events: [ev({ trigger: 'manual (deploy)' })], unit: { load_state: 'not-found', active_state: 'inactive', result: null } }), at(600));
    expect(run.phase).toBe('running');
  });
});

describe('parseTrigger', () => {
  it.each([
    ['web (alice@example.com)', { type: 'web', label: 'alice@example.com' }],
    ['manual (deploy)', { type: 'manual', label: 'deploy' }],
    ['manual', { type: 'manual', label: 'root' }],
    ['webhook [abc123]', { type: 'webhook', label: 'webhook [abc123]' }],
    ['cron', { type: 'unknown', label: 'cron' }],
  ])('%s', (trigger, expected) => {
    expect(parseTrigger(trigger)).toEqual(expected);
  });
});
