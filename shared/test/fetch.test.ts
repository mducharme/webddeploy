import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fetchKeyResponse, fetchSource, fetchTestResponse, sourceSpec } from '../src/index.ts';

const fixture = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));

describe('fetch (copy from another server)', () => {
  it('real ddeploy output parses', () => {
    expect(fetchKeyResponse.parse(fixture('fetch-key')).public_key).toMatch(/^ssh-ed25519 /);
    expect(fetchTestResponse.parse(fixture('fetch-test-unknown')).host_key.status).toBe('unknown');
    const known = fetchTestResponse.parse(fixture('fetch-test-known'));
    expect(known.host_key.status).toBe('known');
    expect(known.files).toBeGreaterThan(0);
  });

  it('the fetch-key fixture holds only the public half', () => {
    expect(JSON.stringify(fixture('fetch-key'))).not.toContain('PRIVATE KEY');
  });

  it.each(['', '.', '/var/www/site/uploads', 'public_html/uploads', '~/uploads'])('path %j is accepted', (path) => {
    expect(fetchSource.safeParse({ user: 'deploy', host: 'old.example.com', path }).success).toBe(true);
  });

  it.each([
    ['host', '-oProxyCommand=id'],
    ['host', 'old_example.com'],
    ['user', 'Root'],
    ['user', '-l'],
    ['path', '/x;id'],
    ['path', '/x$(id)'],
    ['path', '/x y'],
    ['path', 'a/../b'],
    ['path', '..'],
    ['path', '-e'],
  ])('%s %j is refused', (field, value) => {
    expect(fetchSource.safeParse({ user: 'deploy', host: 'old.example.com', path: '', [field]: value }).success).toBe(false);
  });

  it('sourceSpec', () => {
    expect(sourceSpec({ user: 'deploy', host: 'h.example', path: '' })).toBe('deploy@h.example:');
    expect(sourceSpec({ user: 'deploy', host: 'h.example', path: '/var/up' })).toBe('deploy@h.example:/var/up');
  });
});

import { parseTrigger } from '../src/index.ts';

describe('parseTrigger: scheduled runs', () => {
  it('ddeploy cron jobs (DDEPLOY_TRIGGER=schedule)', () => {
    expect(parseTrigger('schedule')).toEqual({ type: 'schedule', label: 'schedule' });
  });
  it('a root CLI run is still the CLI', () => {
    expect(parseTrigger('manual').type).toBe('manual');
  });
});
