import type { Run } from '@webddeploy/shared';
import { describe, expect, it } from 'vitest';
import { finishedToast } from '../src/lib/live.ts';
import { sectionFor, splitBySteps, tail } from '../src/lib/runSteps.ts';

const log = [
  '2026-10-05T13:00:00Z [info] deploying testsite',
  '2026-10-05T13:00:00Z [info] ==> [fetch] Fetch code',
  'From ssh://example/repo',
  '2026-10-05T13:00:02Z [info] ==> [composer-1] Composer: install',
  'Installing dependencies',
  'Your requirements could not be resolved',
  '==> [composer-2] Composer: dump-autoload',
  '',
].join('\n');

describe('splitBySteps', () => {
  it('splits on the markers, with or without a timestamp, keeping what came before', () => {
    const s = splitBySteps(log);
    expect(s.map((x) => x.id)).toEqual(['', 'fetch', 'composer-1', 'composer-2']);
    expect(s[2]!.text).toContain('could not be resolved');
    expect(s[2]!.text).not.toContain('From ssh');
  });
  it('finds a step by label; tail drops the marker and blank lines', () => {
    const sec = sectionFor(splitBySteps(log), 'Composer: install');
    expect(tail(sec!.text)).toBe('Installing dependencies\nYour requirements could not be resolved');
    expect(sectionFor(splitBySteps(log), 'nope')).toBeUndefined();
  });
  it('output without markers is one section', () => {
    expect(splitBySteps('just\noutput\n')).toEqual([{ id: '', label: 'Before the first step', text: 'just\noutput\n' }]);
  });
});

describe('finishedToast', () => {
  const run = { run_id: 'r', site: 'testsite', kind: 'deploy', phase: 'failed', error: 'exit 1', failed_step: 'Composer: install', went_live: false } as Run;
  it('names the failed step and says the old release is still live', () => {
    const t = finishedToast(run);
    expect(t.message).toBe('Deploy testsite failed at “Composer: install”');
    expect(t.detail).toContain('previous release is still live');
  });
  it('without a step (older ddeploy) stays as before', () => {
    expect(finishedToast({ ...run, failed_step: null, went_live: null }).message).toBe('Deploy testsite failed');
  });
});
