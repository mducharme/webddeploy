import { describe, expect, it } from 'vitest';
import { provisionCliCommand, provisionFlags, provisionRequest } from '../src/index.ts';

const base = { name: 'client-site', repo_url: 'git@github.com:org/client-site.git' };

describe('provisionRequest', () => {
  it('accepts the minimum and fills defaults', () => {
    const r = provisionRequest.parse(base);
    expect(r).toMatchObject({ hostnames: [], custom_domains: [], upload_dirs: [], auth: null, build: null });
    expect(provisionFlags(r)).toEqual([]);
  });

  it.each([
    ['uppercase name', { name: 'Client' }],
    ['name too long', { name: 'a'.repeat(29) }],
    ['file:// repo', { repo_url: 'file:///etc' }],
    ['shell in repo', { repo_url: 'git@github.com:org/x.git; id' }],
    ['host starting with -', { repo_url: 'ssh://-oProxyCommand=id/x' }],
    ['branch with ..', { branch: 'feature/../x' }],
    ['branch starting with -', { branch: '-x' }],
    ['php not X.Y', { php: '8' }],
    ['absolute docroot', { docroot: '/etc' }],
    ['docroot with ..', { docroot: '../x' }],
    ['hostname with ;', { hostnames: ['a;b'] }],
    ['absolute upload dir', { upload_dirs: ['/etc'] }],
    ['bad node', { node: 'latest; id' }],
  ])('rejects %s', (_, over) => {
    expect(provisionRequest.safeParse({ ...base, ...over }).success).toBe(false);
  });

  it('turns empty optional strings into null', () => {
    const r = provisionRequest.parse({ ...base, branch: '  ', php: '' });
    expect(r.branch).toBeNull();
    expect(r.php).toBeNull();
  });

  it('builds ddeploy flags in a stable order', () => {
    const r = provisionRequest.parse({
      ...base,
      branch: 'develop',
      php: '8.3',
      docroot: 'web',
      db: 'client_db',
      hostnames: ['alt', 'www2'],
      custom_domains: ['client.com'],
      upload_dirs: ['uploads', '../private'],
      auth: false,
      node: '22',
      build: true,
    });
    expect(provisionFlags(r)).toEqual([
      '--branch', 'develop', '--php', '8.3', '--docroot', 'web', '--db', 'client_db',
      '--hostnames', 'alt www2', '--custom-domains', 'client.com', '--upload-dirs', 'uploads ../private',
      '--no-auth', '--node', '22', '--build',
    ]);
  });

  it('renders the equivalent CLI command, quoted', () => {
    const r = provisionRequest.parse({ ...base, hostnames: ['alt', 'www2'], node: 'lts/*' });
    expect(provisionCliCommand(r)).toBe(
      "ddeploy provision client-site git@github.com:org/client-site.git --non-interactive --hostnames 'alt www2' --node 'lts/*'",
    );
  });
});
