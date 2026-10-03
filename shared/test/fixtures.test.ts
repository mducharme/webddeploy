// Every fixture here is real `ddeploy api` output, captured from the
// docker test harness (ddeploy's docker/test). If ddeploy's output
// changes shape, re-capture them and these tests say what broke.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  apiErrorResponse,
  patterns,
  branchesResponse,
  commitsResponse,
  dbCredentialsResponse,
  dbInfoResponse,
  envResponse,
  uploadsResponse,
  doctorResponse,
  eventsResponse,
  infoResponse,
  inspectRepoResponse,
  logChunk,
  logsResponse,
  previewsResponse,
  runShowResponse,
  siteDetailResponse,
  sitesResponse,
} from '../src/index.ts';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

const cases: Array<[string, z.ZodType]> = [
  ['info', infoResponse],
  ['sites', sitesResponse],
  ['site', siteDetailResponse],
  ['site-preview', siteDetailResponse],
  ['events', eventsResponse],
  ['previews', previewsResponse],
  ['doctor', doctorResponse],
  ['logs', logsResponse],
  ['log-testsite', logChunk],
  ['inspect', inspectRepoResponse],
  ['inspect-unreachable', inspectRepoResponse],
  ['run-show', runShowResponse],
  ['run-log', logChunk],
  ['log-nginx-error', logChunk],
  ['error-not-found', apiErrorResponse],
  ['env', envResponse],
  ['db-info', dbInfoResponse],
  ['db-credentials', dbCredentialsResponse],
  ['branches', branchesResponse],
  ['commits', commitsResponse],
  ['uploads', uploadsResponse],
];

describe('ddeploy api fixtures', () => {
  it.each(cases)('%s parses', (name, schema) => {
    const result = schema.safeParse(fixture(name));
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it('sites carries preview metadata', () => {
    const sites = sitesResponse.parse(fixture('sites')).sites;
    const preview = sites.find((s) => s.preview);
    expect(preview?.preview).toEqual({ project: 'testsite', branch: 'alt-main', mode: 'shared' });
  });

  it('inspect reports what provision would need', () => {
    const r = inspectRepoResponse.parse(fixture('inspect'));
    expect(r.reachable).toBe(true);
    expect(r.detected?.ddev?.name).toBe('testsite');
    expect(r.requires?.php).toBe(false);
  });

  it('sites carry the deploy date and the last run, which skips config changes', () => {
    const site = sitesResponse.parse(fixture('sites')).sites.find((s) => s.name === 'testsite')!;
    expect(site.deployed_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(site.last_deploy?.phase).toBe('succeeded');
    expect(['env-change', 'settings-change']).not.toContain(site.last_run?.kind);
  });

  it('logs include per-site nginx logs and server logs', () => {
    const logs = logsResponse.parse(fixture('logs')).logs;
    expect(logs.find((l) => l.name === 'testsite.error')).toMatchObject({ kind: 'nginx', site: 'testsite' });
    expect(logs.some((l) => l.kind === 'server' && l.name.endsWith('_fpm'))).toBe(true);
    for (const l of logs) expect(patterns.logName.test(l.name)).toBe(true);
  });

  it('site config carries the effective settings', () => {
    const settings = siteDetailResponse.parse(fixture('site')).config?.settings;
    expect(settings?.client_max_body_size).toBe('128m');
    expect(settings?.additional_hostnames).toEqual(['alt-testsite']);
  });

  it('db info lists tables and the pre-import snapshot', () => {
    const db = dbInfoResponse.parse(fixture('db-info'));
    expect(db.tables.map((t) => t.name)).toContain('posts');
    expect(db.snapshots.some((s) => s.reason === 'pre-import')).toBe(true);
  });

  it('env flags the keys ddeploy manages', () => {
    const env = envResponse.parse(fixture('env'));
    expect(env.entries.find((e) => e.key === 'DB_PASSWORD')?.managed).toBe(true);
    expect(env.entries.find((e) => e.key === 'APP_NAME')?.managed).toBe(false);
  });

  it('unreachable repo is a result, not an error', () => {
    const r = inspectRepoResponse.parse(fixture('inspect-unreachable'));
    expect(r.reachable).toBe(false);
    expect(r.error).toBeTruthy();
  });
});

describe('fixture hygiene', () => {
  // Fixtures are captured from the docker test harness: any credential in
  // them must be swapped for an obvious placeholder before committing, or
  // secret scanners (rightly) flag the repo.
  it.each(['db-credentials', 'env'])('%s holds placeholder credentials only', (name) => {
    const text = JSON.stringify(fixture(name));
    const values = [...text.matchAll(/"(?:password|value)":"([^"]*)"/g)].map((m) => m[1]!);
    const secretish = values.filter((v) => /[A-Za-z]/.test(v) && /\d/.test(v) && v.length >= 16 && !v.startsWith('fixture-'));
    expect(secretish).toEqual([]);
  });
});
