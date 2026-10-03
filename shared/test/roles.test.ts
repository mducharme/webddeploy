import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SERVER_SETTINGS, roleAtLeast, serverConfigRequest, serverConfigResponse } from '../src/index.ts';

const config = serverConfigResponse.parse(JSON.parse(readFileSync(new URL('./fixtures/config.json', import.meta.url), 'utf8')));

describe('server settings', () => {
  it('real ddeploy output parses', () => {
    expect(config.settings.length).toBeGreaterThan(10);
    expect(config.readonly.BASE_DOMAIN).toBeTruthy();
  });

  it("the UI describes exactly the settings ddeploy allows (no drift)", () => {
    expect(SERVER_SETTINGS.map((s) => s.key).sort()).toEqual(config.settings.map((s) => s.key).sort());
  });

  it('secrets come back masked', () => {
    const hook = config.settings.find((s) => s.key === 'NOTIFY_WEBHOOK')!;
    expect(hook.secret).toBe(true);
    expect(hook.value).toBe('');
  });

  it.each([
    ['an unknown key', { BASE_DOMAIN: 'x.com' }],
    ['a dollar sign', { FPM_MAX_CHILDREN: '$(id)' }],
    ['a backtick', { DEFAULT_PHP: '8.3`id`' }],
    ['a quote', { DEFAULT_PHP: '8.3"' }],
    ['a newline', { CLIENT_MAX_BODY_SIZE: '64m\nid' }],
    ['a bad bool', { BASIC_AUTH_DEFAULT: 'yes' }],
    ['a bad option', { PREVIEW_DB_MODE: 'both' }],
    ['a bad cron', { BACKUP_SCHEDULE: 'hourly' }],
    ['nothing', {}],
  ])('refuses %s', (_, set) => {
    expect(serverConfigRequest.safeParse({ set }).success).toBe(false);
  });

  it('accepts valid values', () => {
    expect(serverConfigRequest.safeParse({ set: { FPM_MAX_CHILDREN: '8', BACKUP_SCHEDULE: '42 * * * *', NOTIFY_WEBHOOK: '', PREVIEW_DB_MODE: 'isolated' } }).success).toBe(true);
  });
});

describe('roleAtLeast', () => {
  it.each([
    ['viewer', 'viewer', true],
    ['viewer', 'admin', false],
    ['admin', 'viewer', true],
    ['admin', 'superadmin', false],
    ['superadmin', 'admin', true],
    [null, 'viewer', false],
  ] as const)('%s >= %s: %s', (role, needed, expected) => expect(roleAtLeast(role, needed)).toBe(expected));
});
