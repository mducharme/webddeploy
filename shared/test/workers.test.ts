import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { workersResponse } from '../src/index.ts';

describe('workers', () => {
  it('real ddeploy output parses', () => {
    const r = workersResponse.parse(JSON.parse(readFileSync(new URL('./fixtures/workers.json', import.meta.url), 'utf8')));
    expect(r.workers[0]).toMatchObject({ state: 'active', command: 'sleep 1000', log: 'testsite.worker-0' });
    expect(r.schedules[0]).toMatchObject({ cron: '* * * * *', installed: 'current', last: { exit_code: 0 } });
  });
});

import { patterns } from '../src/index.ts';

describe('log names (same rule as ddeploy)', () => {
  it.each(['testsite.worker-0', 'testsite.schedule-12', 'testsite.error', 'testsite', 'php8.3_fpm'])('%s is a log', (n) => expect(patterns.logName.test(n)).toBe(true));
  it.each(['testsite.worker-', 'testsite.worker-123', 'testsite.cron-0', '../x'])('%s is not', (n) => expect(patterns.logName.test(n)).toBe(false));
});
