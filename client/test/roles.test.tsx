import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Me, Role, ServerConfigResponse } from '@webddeploy/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { keys } from '../src/lib/api.ts';
import { Can } from '../src/lib/role.tsx';
import { configChanges } from '../src/pages/ServerSettingsPage.tsx';

function asRole(role: Role, ui: React.ReactNode) {
  const qc = new QueryClient();
  const me: Me = { email: 'x@example.com', name: null, picture: null, role, servers: [{ id: 'local', name: 'local' }] };
  qc.setQueryData(keys.me, me);
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('Can', () => {
  it.each([
    ['viewer', 'admin', false],
    ['admin', 'admin', true],
    ['superadmin', 'admin', true],
    ['admin', 'superadmin', false],
  ] as const)('%s sees %s-only things: %s', (role, needed, visible) => {
    asRole(role, <Can role={needed}><button type="button">Deploy</button></Can>);
    expect(screen.queryByRole('button', { name: 'Deploy' }) !== null).toBe(visible);
  });
});

describe('server settings changes', () => {
  const config: ServerConfigResponse = {
    api_version: 1,
    file: '/etc/ddeploy/provisioner.conf',
    readonly: {},
    backups_configured: true,
    settings: [
      { key: 'FPM_MAX_CHILDREN', value: '5', secret: false, is_set: true, explicit: false, apply: 'deploy' },
      { key: 'NOTIFY_WEBHOOK', value: '', secret: true, is_set: true, explicit: true, apply: 'now' },
    ],
  };

  it('only changed values', () => {
    expect(configChanges(config, { FPM_MAX_CHILDREN: '5' })).toEqual({});
    expect(configChanges(config, { FPM_MAX_CHILDREN: ' 8 ' })).toEqual({ FPM_MAX_CHILDREN: '8' });
  });

  it('a secret is sent only when typed, or explicitly turned off', () => {
    expect(configChanges(config, { NOTIFY_WEBHOOK: '' })).toEqual({});
    expect(configChanges(config, { NOTIFY_WEBHOOK: 'https://hooks.example/x' })).toEqual({ NOTIFY_WEBHOOK: 'https://hooks.example/x' });
    expect(configChanges(config, { NOTIFY_WEBHOOK: '', 'NOTIFY_WEBHOOK:clear': '1' })).toEqual({ NOTIFY_WEBHOOK: '' });
  });
});
