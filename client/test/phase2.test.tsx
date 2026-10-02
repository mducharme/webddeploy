import { SETTINGS, type Run, type SiteSummary } from '@webddeploy/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LogView, segment } from '../src/components/LogView.tsx';
import type { MaskedEnvEntry } from '../src/lib/api.ts';
import { applyPasted, diff, parsePasted, rowError, rowsFrom } from '../src/lib/envEdit.ts';
import { FLEET_VIEWS } from '../src/pages/Fleet.tsx';
import { HISTORY_FILTERS } from '../src/pages/HistoryTab.tsx';
import { settingsChange } from '../src/pages/SettingsTab.tsx';

const entry = (key: string, value: string, o: Partial<MaskedEnvEntry> = {}): MaskedEnvEntry => ({ key, value, managed: false, masked: false, length: value.length, ...o });

describe('env editor', () => {
  const base = rowsFrom([entry('APP_NAME', 'Site'), entry('API_KEY', '', { masked: true, length: 12 }), entry('DB_PASSWORD', '', { masked: true, managed: true, length: 24 })]);

  it('no edits, no change', () => {
    expect(diff(base)).toEqual({ set: {}, unset: [] });
  });

  it('sends only what changed: edits, new keys, deletions', () => {
    const rows = base.map((r) => (r.key === 'APP_NAME' ? { ...r, draft: 'New name' } : r.key === 'API_KEY' ? { ...r, deleted: true } : r));
    rows.push({ key: 'MAIL_HOST', original: null, masked: false, managed: false, length: 0, draft: 'smtp', deleted: false, isNew: true });
    expect(diff(rows)).toEqual({ set: { APP_NAME: 'New name', MAIL_HOST: 'smtp' }, unset: ['API_KEY'] });
  });

  it('never sends a masked value it never saw', () => {
    const rows = base.map((r) => ({ ...r, draft: r.masked ? null : r.draft }));
    expect(Object.keys(diff(rows).set)).toEqual([]);
  });

  it('a new row deleted again is simply gone', () => {
    const rows = [...base, { key: 'X', original: null, masked: false, managed: false, length: 0, draft: '1', deleted: true, isNew: true }];
    expect(diff(rows)).toEqual({ set: {}, unset: [] });
  });

  it('flags invalid and duplicate keys', () => {
    const bad = { key: 'BAD-KEY', original: null, masked: false, managed: false, length: 0, draft: '1', deleted: false, isNew: true };
    const dup = { ...bad, key: 'APP_NAME' };
    expect(rowError(bad, [...base, bad])).toContain('letters');
    expect(rowError(dup, [...base, dup])).toBe('duplicate key');
  });

  it('parses a pasted .env', () => {
    expect(parsePasted('# comment\nexport A=1\n\nB="two words"\nnot a line\n')).toEqual([
      { key: 'A', value: '1' },
      { key: 'B', value: '"two words"' },
    ]);
  });

  it('pasting updates existing keys and adds new ones', () => {
    const rows = applyPasted(base, [{ key: 'APP_NAME', value: 'Pasted' }, { key: 'NEW', value: 'x' }]);
    expect(diff(rows)).toEqual({ set: { APP_NAME: 'Pasted', NEW: 'x' }, unset: [] });
  });
});

describe('settings form', () => {
  const effective = { client_max_body_size: '64m', basic_auth: 'false', additional_hostnames: ['alt'] };

  it('only changed values are set; lists compared by content', () => {
    const req = settingsChange(SETTINGS, effective, { client_max_body_size: '64m', basic_auth: 'true', additional_hostnames: 'alt,  ' }, new Set(), undefined);
    expect(req).toEqual({ set: { basic_auth: 'true' }, unset: [] });
  });

  it('resets win over drafts, and branch is passed through', () => {
    const req = settingsChange(SETTINGS, effective, { client_max_body_size: '128m' }, new Set(['client_max_body_size']), null);
    expect(req).toEqual({ set: {}, unset: ['client_max_body_size'], branch: null });
  });

  it('lists are sent as arrays', () => {
    expect(settingsChange(SETTINGS, effective, { additional_hostnames: 'alt www2' }, new Set(), undefined).set).toEqual({ additional_hostnames: ['alt', 'www2'] });
  });
});

describe('log highlighting', () => {
  it('groups plain lines and isolates [error]/[warn] lines', () => {
    expect(segment('a\nb\n[warn]  w\nc\n[error] boom\nd')).toEqual([
      { kind: 'text', text: 'a\nb\n' },
      { kind: 'warn', text: '[warn]  w\n' },
      { kind: 'text', text: 'c\n' },
      { kind: 'error', text: '[error] boom\n' },
      { kind: 'text', text: 'd' },
    ]);
  });

  it('offers a jump to the first error', () => {
    render(<LogView text={'ok\n[error] one\n[error] two\n'} />);
    expect(screen.getAllByTestId('log-error')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /first error \(of 2\)/i })).toBeInTheDocument();
  });

  it('no button without errors', () => {
    render(<LogView text={'all good\n'} />);
    expect(screen.queryByRole('button', { name: /first error/i })).toBeNull();
  });
});

const run = (o: Partial<Run>): Run => ({
  run_id: 'r', site: 's', kind: 'deploy', phase: 'succeeded', trigger: 't', started_at: null, finished_at: null, duration_s: null,
  from_sha: null, to_sha: null, subject: null, branch: null, project: null, error: null, ...o,
});

describe('history filters', () => {
  const runs = [run({}), run({ phase: 'failed' }), run({ kind: 'env-change' }), run({ kind: 'db-import' }), run({ phase: 'unknown', kind: 'rollback' })];
  it.each([
    ['all', 5],
    ['failed', 2],
    ['deploys', 3],
    ['database', 1],
    ['changes', 1],
  ] as const)('%s', (f, n) => expect(runs.filter(HISTORY_FILTERS[f].match)).toHaveLength(n));
});

describe('fleet views', () => {
  const site = (o: Partial<SiteSummary>): SiteSummary => ({
    name: 'x', url: '', php: null, node: null, build: false, docroot: '.', db: null, branch: null, sha: null, committed_at: null, subject: null, repo: null, preview: null, last_event: null, ...o,
  });
  const ev = (phase: 'started' | 'succeeded' | 'failed') => ({ ts: '', run_id: 'r', site: 'x', kind: 'deploy', phase, trigger: 't' });
  it('needs attention: failing health or a failed last run', () => {
    expect(FLEET_VIEWS.attention.match(site({}), 'warn')).toBe(true);
    expect(FLEET_VIEWS.attention.match(site({ last_event: ev('failed') }), 'ok')).toBe(true);
    expect(FLEET_VIEWS.attention.match(site({ last_event: ev('succeeded') }), 'ok')).toBe(false);
  });
  it('running: last event is a start', () => {
    expect(FLEET_VIEWS.running.match(site({ last_event: ev('started') }))).toBe(true);
  });
});
