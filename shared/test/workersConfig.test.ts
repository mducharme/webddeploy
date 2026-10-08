import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { presetsFor, workersConfigRequest, workersResponse, workersYaml } from '../src/index.ts';

const fx = JSON.parse(readFileSync(new URL('./fixtures/workers.json', import.meta.url), 'utf8'));

describe('workers response (server-side lists)', () => {
  it('parses real ddeploy output with sources and both lists', () => {
    const d = workersResponse.parse(fx);
    expect(d.sources).toEqual({ workers: 'repo', schedules: 'repo' });
    expect(d.repo?.queue_workers).toEqual(['sleep 1000']);
    expect(d.server).toEqual({ queue_workers: [], schedule: [] });
  });
  it('older ddeploy output (no sources) still parses', () => {
    const { sources, server, repo, framework, docroot, deployed, ...old } = fx;
    void [sources, server, repo, framework, docroot, deployed];
    expect(workersResponse.parse(old).sources).toBeUndefined();
  });
});

describe('workersConfigRequest', () => {
  const ok = { queue_workers: ['php artisan queue:work'], schedule: [{ cron: '*/5 * * * *', cmd: 'php artisan schedule:run' }] };
  it('accepts a normal config, trimming', () => {
    expect(workersConfigRequest.parse({ ...ok, queue_workers: ['  php artisan queue:work  '] }).queue_workers[0]).toBe('php artisan queue:work');
  });
  it.each([
    ['a non-cron schedule', { ...ok, schedule: [{ cron: 'daily', cmd: 'x' }] }],
    ['an empty command', { ...ok, queue_workers: [' '] }],
    ['a multi-line command', { ...ok, queue_workers: ['a\nb'] }],
    ['a DDEV-only command', { ...ok, queue_workers: ['ddev exec php artisan queue:work'] }],
    ['21 workers', { ...ok, queue_workers: Array(21).fill('x') }],
  ])('refuses %s', (_, body) => expect(workersConfigRequest.safeParse(body).success).toBe(false));
});

describe('presetsFor', () => {
  it('Laravel: a queue worker and the scheduler every minute', () => {
    const p = presetsFor('laravel');
    expect(p.name).toBe('Laravel');
    expect(p.workers[0]!.cmd).toContain('queue:work');
    expect(p.schedules[0]).toMatchObject({ cron: '* * * * *', cmd: 'php artisan schedule:run' });
  });
  it('WordPress cron points into the docroot (Bedrock: web/wp)', () => {
    expect(presetsFor('wordpress', '.').schedules[0]!.cmd).toBe('php wp-cron.php');
    expect(presetsFor('wordpress-bedrock', 'web').schedules[0]!.cmd).toBe('php web/wp/wp-cron.php');
  });
  it('unknown: nothing suggested', () => expect(presetsFor(null)).toEqual({ name: null, workers: [], schedules: [] }));
  it('every preset passes the request validation', () => {
    for (const f of ['laravel', 'craftcms', 'wordpress', 'wordpress-bedrock', 'symfony']) {
      const p = presetsFor(f, 'web');
      expect(workersConfigRequest.safeParse({ queue_workers: p.workers.map((w) => w.cmd), schedule: p.schedules.map(({ cron, cmd }) => ({ cron, cmd })) }).success).toBe(true);
    }
  });
});

describe('workersYaml', () => {
  it('writes what .ddeploy/config.yaml expects, quoting when needed', () => {
    expect(workersYaml({ queue_workers: ['php artisan queue:work --tries=3'], schedule: [{ cron: '* * * * *', cmd: 'echo "hi" >> /tmp/x' }] })).toBe(
      'queue_workers:\n  - php artisan queue:work --tries=3\nschedule:\n  - cron: "* * * * *"\n    cmd: "echo \\"hi\\" >> /tmp/x"\n',
    );
    expect(workersYaml({ queue_workers: [], schedule: [] })).toBe('');
  });
});
