import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { SessionStore } from '../src/auth/sessions.ts';
import { SwrCache } from '../src/cache.ts';
import { loadConfig, parseCommand } from '../src/config.ts';
import { CommandConnector, DdeployError } from '../src/ddeploy/connector.ts';
import { DdeployClient } from '../src/ddeploy/client.ts';
import { openDb } from '../src/db.ts';

const fake = fileURLToPath(new URL('./fake-ddeploy.mjs', import.meta.url));

describe('CommandConnector', () => {
  const connector = (env: Record<string, string> = {}, timeout?: number) => {
    Object.assign(process.env, env);
    return new CommandConnector([process.execPath, fake], timeout);
  };

  it('parses and validates real fixture output', async () => {
    const client = new DdeployClient(connector({ FAKE_DDEPLOY_MODE: '' }));
    const sites = await client.sites();
    expect(sites.sites[0]?.name).toBe('testsite');
  });

  it('passes every argument as its own argv entry, untouched', async () => {
    const out = (await connector({ FAKE_DDEPLOY_MODE: 'echo' }).call(['inspect-repo', 'a b; $(id)', '--branch', "x'y"])) as { argv: string[] };
    expect(out.argv).toEqual(['api', 'inspect-repo', 'a b; $(id)', '--branch', "x'y"]);
  });

  it('turns a ddeploy error object into a DdeployError with its code', async () => {
    const client = new DdeployClient(connector({ FAKE_DDEPLOY_MODE: '' }));
    await expect(client.site('nope')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('reports non-JSON output with the stderr tail', async () => {
    await expect(connector({ FAKE_DDEPLOY_MODE: 'garbage' }).call(['info'])).rejects.toThrow(/returned no JSON: \[error\] something exploded/);
  });

  it('times out', async () => {
    await expect(connector({ FAKE_DDEPLOY_MODE: 'hang' }, 300).call(['info'])).rejects.toMatchObject({ code: 'timeout' });
  });

  it('over ssh, quotes each argument for the remote shell', async () => {
    const fakeSsh = fileURLToPath(new URL('./fake-ssh.sh', import.meta.url));
    process.env.FAKE_DDEPLOY_MODE = 'echo';
    const c = new CommandConnector([fakeSsh, 'deploy@host', process.execPath, fake], 10_000, true);
    const out = (await c.call(['inspect-repo', "a b; $(touch /tmp/pwned) `id` 'q'", '--hostnames', 'alt www2'])) as { argv: string[] };
    expect(out.argv).toEqual(['api', 'inspect-repo', "a b; $(touch /tmp/pwned) `id` 'q'", '--hostnames', 'alt www2']);
  });

  it('detects ssh from the command name', () => {
    expect(new CommandConnector(['ssh', 'deploy@host', 'sudo', '-n', '/opt/ddeploy/provision.sh']).remoteShell).toBe(true);
    expect(new CommandConnector(['/usr/bin/ssh', 'h']).remoteShell).toBe(true);
    expect(new CommandConnector(['sudo', '-n', '/opt/ddeploy/provision.sh']).remoteShell).toBe(false);
  });

  it('reports a missing command as unavailable', async () => {
    await expect(new CommandConnector(['/nonexistent/provision.sh']).call(['info'])).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('DdeployClient', () => {
  it('refuses a newer api_version', async () => {
    const client = new DdeployClient({ call: async () => ({ api_version: 2 }), stream: async () => { throw new Error('unused'); } });
    await expect(client.info()).rejects.toMatchObject({ code: 'incompatible' });
  });

  it('refuses a response that does not match the contract', async () => {
    const client = new DdeployClient({ call: async () => ({ api_version: 1, sites: [{ name: 3 }] }), stream: async () => { throw new Error('unused'); } });
    await expect(client.sites()).rejects.toThrow(DdeployError);
  });
});

describe('SessionStore', () => {
  it('expires idle sessions and caps their total lifetime', () => {
    let t = 1_000_000;
    const store = new SessionStore(openDb(':memory:'), { idleMs: 1000, maxMs: 5000, now: () => t });
    const token = store.create({ email: 'a@b.c', name: null, picture: null });
    t += 900;
    expect(store.get(token)?.email).toBe('a@b.c');
    t += 1100;
    expect(store.get(token)).toBeNull();

    const kept = store.create({ email: 'a@b.c', name: null, picture: null });
    for (let i = 0; i < 6; i++) {
      t += 900;
      store.get(kept);
    }
    expect(store.get(kept)).toBeNull();
  });

  it('never stores the raw token', () => {
    const db = openDb(':memory:');
    const token = new SessionStore(db, { idleMs: 1000, maxMs: 5000 }).create({ email: 'a@b.c', name: null, picture: null });
    const row = db.prepare('SELECT id_hash FROM sessions').get() as { id_hash: string };
    expect(row.id_hash).not.toBe(token);
    expect(row.id_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('SwrCache', () => {
  it('serves fresh, then stale while refreshing, and shares in-flight loads', async () => {
    let t = 0;
    let loads = 0;
    const cache = new SwrCache(() => t);
    const load = async () => ++loads;
    const [a, b] = await Promise.all([cache.get('k', 100, load), cache.get('k', 100, load)]);
    expect([a, b, loads]).toEqual([1, 1, 1]);
    t = 50;
    expect(await cache.get('k', 100, load)).toBe(1);
    t = 200;
    expect(await cache.get('k', 100, load)).toBe(1); // stale, refresh started
    await new Promise((r) => setTimeout(r, 0));
    expect(await cache.get('k', 100, load)).toBe(2);
  });

  it('does not cache failures', async () => {
    const cache = new SwrCache();
    await expect(cache.get('k', 100, async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(await cache.get('k', 100, async () => 5)).toBe(5);
  });
});

describe('config', () => {
  const base = { ADMIN_EMAILS: 'A@Example.com', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' };

  it('normalizes emails and parses the ddeploy command', () => {
    const c = loadConfig(base);
    expect(c.adminEmails).toEqual(['a@example.com']);
    expect(c.servers[0]?.command).toEqual(['sudo', '-n', '/opt/ddeploy/provision.sh']);
  });

  it('accepts a JSON array command', () => {
    expect(parseCommand('["docker","exec","-i","web","/opt/ddeploy/provision.sh"]')).toHaveLength(5);
  });

  it('refuses dev login in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', PUBLIC_URL: 'https://x', DEV_LOGIN_EMAIL: 'a@b.c' })).toThrow(/DEV_LOGIN_EMAIL/);
  });

  it('requires https in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', PUBLIC_URL: 'http://x' })).toThrow(/https/);
  });

  it('requires some way to sign in', () => {
    expect(() => loadConfig({ ADMIN_EMAILS: 'a@b.c' })).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it('accepts several servers', () => {
    const c = loadConfig({ ...base, SERVERS: JSON.stringify([{ id: 'a', name: 'A', command: ['x'] }, { id: 'b', name: 'B', command: ['y'] }]) });
    expect(c.servers.map((s) => s.id)).toEqual(['a', 'b']);
  });
});
