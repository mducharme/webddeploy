import type { FetchTestResponse } from '@webddeploy/shared';
import { describe, expect, it } from 'vitest';
import { authorizedKeysLine, nextStep } from '../src/pages/CopyFromServer.tsx';

const key = 'ssh-ed25519 AAAAC3Nza ddeploy-fetch@web';

describe('authorizedKeysLine', () => {
  it('binds the key to the folder, read-only, with rrsync', () => {
    expect(authorizedKeysLine(key, ' /var/www/up ', true)).toBe(`command="rrsync -ro /var/www/up",restrict ${key}`);
  });
  it('shows a placeholder until a folder is typed', () => {
    expect(authorizedKeysLine(key, '', true)).toContain('rrsync -ro /path/to/uploads');
  });
  it('without rrsync: still no shell features (restrict)', () => {
    expect(authorizedKeysLine(key, '/var/www/up', false)).toBe(`restrict ${key}`);
  });
});

describe('nextStep', () => {
  const t = (o: Partial<FetchTestResponse>): FetchTestResponse => ({
    api_version: 1, host: 'h', port: 22, host_key: { status: 'known', fingerprints: [] }, files: null, bytes: null, error: null, ...o,
  });
  it.each([
    ['nothing tested yet', undefined, 'test'],
    ['a new host', t({ host_key: { status: 'unknown', fingerprints: [{ type: 'ED25519', fingerprint: 'SHA256:x' }] } }), 'confirm'],
    ['a changed host key', t({ host_key: { status: 'changed', fingerprints: [] }, error: 'different' }), 'changed'],
    ['unreachable', t({ host_key: { status: 'unreachable', fingerprints: [] }, error: "can't reach" }), 'fix'],
    ['key refused', t({ error: 'refused the key' }), 'fix'],
    ['ready', t({ files: 3, bytes: 26 }), 'copy'],
  ] as const)('%s → %s', (_, test, step) => expect(nextStep(test)).toBe(step));
});
