import { describe, expect, it } from 'vitest';
import { deployRelation, type Run } from '../src/index.ts';

const r = (id: string, from: string | null, to: string, phase: Run['phase'] = 'succeeded'): Run =>
  ({ run_id: id, site: 's', kind: 'deploy', phase, trigger: 'manual', started_at: null, finished_at: null, duration_s: null, from_sha: from, to_sha: to, subject: null, branch: null, project: null, error: null }) as Run;

describe('deployRelation', () => {
  it('the commit that was already live: same', () => {
    const h = [r('3', 'bbb', 'bbb'), r('2', 'aaa', 'bbb'), r('1', null, 'aaa')];
    expect(deployRelation(h[0]!, h)).toEqual({ kind: 'same' });
  });
  it('back to a commit an older deploy shipped: earlier, with that run', () => {
    const h = [r('3', 'bbb', 'aaa'), r('2', 'aaa', 'bbb'), r('1', null, 'aaa')];
    expect(deployRelation(h[0]!, h)).toMatchObject({ kind: 'earlier', run: { run_id: '1' } });
  });
  it('a new commit: nothing to say', () => {
    const h = [r('2', 'aaa', 'bbb'), r('1', null, 'aaa')];
    expect(deployRelation(h[0]!, h)).toBeNull();
  });
  it('failed runs say nothing', () => expect(deployRelation(r('2', 'aaa', 'aaa', 'failed'), [])).toBeNull());
});
