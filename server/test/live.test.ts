import { describe, expect, it } from 'vitest';
import { FakeConnector, makeApp, testConfig } from './helpers.ts';

const started = { ts: new Date(Date.now() - 5000).toISOString(), run_id: '20261003T100000Z-aaaaaa', site: 'testsite', kind: 'deploy', phase: 'started', trigger: 'webhook [x] by octo' };
const done = { ...started, ts: new Date().toISOString(), phase: 'succeeded', duration_s: 4, to_sha: 'abc1234' };

/** Reads SSE `live` messages for a while, then disconnects. */
async function readLive(app: ReturnType<typeof makeApp>, ms: number) {
  const ctrl = new AbortController();
  const res = await app.req('/api/servers/local/live', { signal: ctrl.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const stop = setTimeout(() => {
    void reader.cancel();
    ctrl.abort();
  }, ms);
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      text += decoder.decode(value);
    }
  } catch {
    /* aborted */
  }
  clearTimeout(stop);
  return text
    .split('\n\n')
    .filter((b) => b.includes('event: live'))
    .map((b) => JSON.parse(b.split('\n').find((l) => l.startsWith('data: '))!.slice(6)));
}

describe('/live', () => {
  it('reports the runs in progress, then each one that finished', async () => {
    let calls = 0;
    const connector = new FakeConnector().on('events', () => ({ api_version: 1, events: ++calls === 1 ? [started] : [started, done] }));
    const app = makeApp({ connector, config: testConfig({ LIVE_POLL_MS: '500' }) });
    const messages = await readLive(app, 1800);
    expect(messages[0].running.map((r: { run_id: string }) => r.run_id)).toEqual([started.run_id]);
    expect(messages[0].finished).toEqual([]);
    const later = messages.find((m) => m.finished.length);
    expect(later.finished[0]).toMatchObject({ run_id: started.run_id, phase: 'succeeded', site: 'testsite' });
    expect(later.running).toEqual([]);
    expect(later.changed_sites).toContain('testsite');
  });

  it('a run that started and finished between two checks still counts as finished', async () => {
    let calls = 0;
    const connector = new FakeConnector().on('events', () => ({ api_version: 1, events: ++calls === 1 ? [] : [started, done] }));
    const messages = await readLive(makeApp({ connector, config: testConfig({ LIVE_POLL_MS: '500' }) }), 1800);
    expect(messages.find((m) => m.finished.length)?.finished[0]).toMatchObject({ run_id: started.run_id, phase: 'succeeded' });
  });

  it('configuration changes are not toasted', async () => {
    let calls = 0;
    const change = { ts: new Date().toISOString(), run_id: null, site: 'testsite', kind: 'env-change', phase: 'succeeded', trigger: 'web (a@b.c)' };
    const connector = new FakeConnector().on('events', () => ({ api_version: 1, events: ++calls === 1 ? [] : [change] }));
    const messages = await readLive(makeApp({ connector, config: testConfig({ LIVE_POLL_MS: '500' }) }), 1800);
    expect(messages.every((m) => m.finished.length === 0)).toBe(true);
  });

  it('nothing new: no repeated messages', async () => {
    const connector = new FakeConnector().on('events', () => ({ api_version: 1, events: [started, done] }));
    const messages = await readLive(makeApp({ connector, config: testConfig({ LIVE_POLL_MS: '500' }) }), 1800);
    expect(messages).toHaveLength(1);
    expect(messages[0].finished).toEqual([]);
  });

  it('viewers can follow it', async () => {
    const connector = new FakeConnector().on('events', () => ({ api_version: 1, events: [] }));
    const res = await Promise.resolve(makeApp({ connector, as: 'viewer@example.com' }).req('/api/servers/local/live', { signal: AbortSignal.timeout(300) })).catch(() => null);
    expect(res?.status).toBe(200);
  });
});
