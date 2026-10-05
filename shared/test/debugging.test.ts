import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deployCheckResponse, doctorCheck, errorsResponse, runShowResponse } from '../src/index.ts';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));

describe('debugging schemas', () => {
  it('deploy-check and errors parse', () => {
    expect(deployCheckResponse.parse(fx('deploy-check')).up_to_date).toBe(false);
    expect(errorsResponse.parse(fx('errors')).groups).toHaveLength(2);
  });
  it('a doctor check with where to look', () => {
    expect(doctorCheck.parse({ status: 'fail', check: 'http', detail: 'GET / -> 500: PHP Fatal error', see: { type: 'log', log: 'x.error', find: 'PHP Fatal' } }).see).toMatchObject({ type: 'log' });
    expect(doctorCheck.parse({ status: 'ok', check: 'vhost', detail: 'enabled', see: null }).see).toBeNull();
    expect(doctorCheck.parse({ status: 'ok', check: 'vhost', detail: 'enabled' }).see).toBeUndefined();
  });
  it('older run show output (no steps) still parses', () => {
    const show = fx('run-show');
    delete show.steps;
    expect(runShowResponse.parse(show).steps).toBeUndefined();
  });
});
