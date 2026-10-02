import { describe, expect, it } from 'vitest';
import { commitUrl, duration, relativeTime, shortSha } from '../src/lib/format.ts';
import { stripAnsi } from '../src/lib/stream.ts';

describe('commitUrl', () => {
  const sha = 'abc123';
  it.each([
    ['git@github.com:org/repo.git', 'https://github.com/org/repo/commit/abc123'],
    ['ssh://git@github.com/org/repo.git', 'https://github.com/org/repo/commit/abc123'],
    ['https://github.com/org/repo', 'https://github.com/org/repo/commit/abc123'],
    ['git@gitlab.com:group/sub/repo.git', 'https://gitlab.com/group/sub/repo/-/commit/abc123'],
    ['git@bitbucket.org:team/repo.git', 'https://bitbucket.org/team/repo/commits/abc123'],
    ['ssh://gitfixture@127.0.0.1/srv/git/testsite.git', null],
    ['git@git.internal.example:org/repo.git', null],
  ])('%s', (remote, expected) => expect(commitUrl(remote, sha)).toBe(expected));

  it('null without a sha', () => expect(commitUrl('git@github.com:o/r.git', null)).toBeNull());
});

describe('formatting', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  it.each([
    ['2026-10-02T11:59:50Z', '10s ago'],
    ['2026-10-02T11:50:00Z', '10m ago'],
    ['2026-10-02T09:00:00Z', '3h ago'],
    ['2026-09-28T12:00:00Z', '4d ago'],
    ['2026-01-01T00:00:00Z', '2026-01-01'],
  ])('relativeTime(%s)', (iso, expected) => expect(relativeTime(iso, now)).toBe(expected));

  it.each([
    [null, '—'],
    [5, '5s'],
    [65, '1m 5s'],
    [120, '2m'],
    [3720, '1h 2m'],
  ])('duration(%s)', (s, expected) => expect(duration(s)).toBe(expected));

  it('shortSha', () => {
    expect(shortSha('0123456789abcdef')).toBe('0123456');
    expect(shortSha(null)).toBe('—');
  });

  it('strips ANSI colors from build output', () => {
    expect(stripAnsi('\x1b[1m\x1b[32mok\x1b[0m done\x1b[?25h')).toBe('ok done');
  });
});
